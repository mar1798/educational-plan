/**
 * Фазы семестра (§этап Д). Фаза — непрерывный отрезок учебных недель, в котором набор действующих
 * строк нагрузки не меняется. Границы дают `week_from` и `week_to + 1` всех строк семестра; каждая
 * фаза получает свою версию шаблона недели. Обычно выходит 2–4 фазы (нед. 1–3 только лекции,
 * 4–6 лекции и практика, 7–18 практика).
 */
import { and, eq, isNull } from 'drizzle-orm'
import { resolveLoadWeeks, type ResolvedLoadWeeks } from '../../shared/load/weeks'
import { NotFoundError } from '../db/repo/base-repo'
import { weeksContextOf } from '../db/repo/teaching-load'
import type { DbLike } from '../db/repo/types'
import { semester } from '../db/schema/calendar'
import { curriculumRow, discipline } from '../db/schema/curriculum'
import { stream, teachingLoad } from '../db/schema/load'
import { studyGroup } from '../db/schema/people'
import { studyWeeksOfSemester } from './study-weeks'

export interface PhaseLoad {
  loadId: number
  label: string
}

export interface SemesterPhase {
  no: number
  weekFrom: number
  weekTo: number
  /** Первый день версии шаблона этой фазы: понедельник её первой учебной недели (не раньше начала семестра). */
  effectiveFrom: string
  loads: PhaseLoad[]
  /** Что дало начало фазы: «начинается …» / «заканчивается …». У первой фазы пусто. */
  startedBy: string[]
  /** Фаза в одну неделю — кандидат на склейку: отчёт показывает, какая строка дала границу. */
  short: boolean
}

export interface SemesterPhasesReport {
  phases: SemesterPhase[]
  /** Строки нагрузки с неверными неделями — в фазы не попали. */
  problems: string[]
}

const KIND_RU = { theory: 'теория', practice: 'практика', seminar: 'семинар', lab: 'лаборатория' } as const

/** Строка нагрузки действует во ВСЕХ неделях отрезка — так её отбирает и снимок для солвера. */
export function loadCoversWeeks(resolved: ResolvedLoadWeeks, from: number, to: number): boolean {
  return resolved.weekFrom <= from && resolved.weekTo >= to
}

export function semesterPhases(tx: DbLike, semesterId: number): SemesterPhasesReport {
  const sem = tx.select().from(semester).where(eq(semester.id, semesterId)).get()
  if (!sem) throw new NotFoundError('semester', semesterId)
  const ctx = weeksContextOf(sem)

  const disciplineOfRow = new Map(
    tx
      .select({ id: curriculumRow.id, name: discipline.name })
      .from(curriculumRow)
      .innerJoin(discipline, eq(discipline.id, curriculumRow.disciplineId))
      .all()
      .map((r) => [r.id, r.name]),
  )
  const groups = new Map(tx.select().from(studyGroup).all().map((g) => [g.id, g.name]))
  const streams = new Map(tx.select().from(stream).all().map((s) => [s.id, s.name]))

  const problems: string[] = []
  const active: { load: typeof teachingLoad.$inferSelect; resolved: ResolvedLoadWeeks; label: string }[] = []
  for (const load of tx.select().from(teachingLoad).where(and(eq(teachingLoad.semesterId, semesterId), isNull(teachingLoad.validTo))).all()) {
    const target = load.groupId != null ? (groups.get(load.groupId) ?? `группа #${load.groupId}`) : (streams.get(load.streamId!) ?? `поток #${load.streamId}`)
    const label = `«${disciplineOfRow.get(load.curriculumRowId) ?? `строка плана #${load.curriculumRowId}`}» (${target}, ${KIND_RU[load.lessonKind]})`
    try {
      active.push({ load, resolved: resolveLoadWeeks(load, ctx), label })
    } catch (e) {
      problems.push(`${label}: ${e instanceof Error ? e.message : 'неверные недели'}`)
    }
  }

  // Границы: 1, week_from и week_to + 1 каждой строки.
  const starts = new Map<number, string[]>([[1, []]])
  const addStart = (week: number, cause: string) => {
    if (week > ctx.weeksCount) return
    starts.set(week, [...(starts.get(week) ?? []), cause])
  }
  for (const a of active) {
    addStart(a.resolved.weekFrom, `${a.label} начинается`)
    addStart(a.resolved.weekTo + 1, `${a.label} заканчивается`)
  }

  const weeks = studyWeeksOfSemester(tx, semesterId)
  const mondayOf = (no: number): string => {
    const found = weeks.find((w) => w.no === no)
    if (found) return found.monday
    // Календарь дал меньше учебных недель, чем в семестре: даты считаем от последней известной.
    const last = weeks.at(-1)
    const base = new Date(`${(last?.monday ?? sem.startsOn)}T00:00:00Z`)
    base.setUTCDate(base.getUTCDate() + 7 * (no - (last?.no ?? 1)))
    return base.toISOString().slice(0, 10)
  }

  const boundaries = [...starts.keys()].sort((a, b) => a - b)
  const phases: SemesterPhase[] = boundaries.map((from, i) => {
    const to = (boundaries[i + 1] ?? ctx.weeksCount + 1) - 1
    const monday = mondayOf(from)
    return {
      no: i + 1,
      weekFrom: from,
      weekTo: to,
      effectiveFrom: monday < sem.startsOn ? sem.startsOn : monday,
      loads: active.filter((a) => loadCoversWeeks(a.resolved, from, to)).map((a) => ({ loadId: a.load.id, label: a.label })),
      startedBy: from === 1 ? [] : (starts.get(from) ?? []),
      short: to === from,
    }
  })
  return { phases, problems }
}
