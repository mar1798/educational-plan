/**
 * Загрузка готового расписания из сетки колледжа (§этап Ж, решения п. 52). Это не противоречит
 * п. 47: мастер сопоставления колонок рассчитан на списки (строка = запись), а сетка
 * «день × пара / группа» списком не является, поэтому у неё отдельный путь — но тоже без привязки
 * к адресам ячеек (`detect.ts`).
 *
 * Записи встают в НОВУЮ черновую версию шаблона выбранного семестра как закреплённые (`is_locked`):
 * солвер достраивает остальное, не сдвигая загруженное. Нераспознанное попадает в `problems` с
 * причиной и молча не создаётся — как в `apply.ts`.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { findConflicts, type SlotEntry } from '../../../solver/validate'
import { describeConflicts } from '../../../shared/schedule/messages'
import type { Grid } from '../../../shared/import/engine'
import type { AuditContext } from '../../db/repo/audit'
import { createRow, NotFoundError, updateRow } from '../../db/repo/base-repo'
import { resolveLoadWeeks, type SemesterWeeksContext } from '../../../shared/load/weeks'
import { weeksContextOf } from '../../db/repo/teaching-load'
import { buildTemplateLookup, createTemplate, nameResolver, resolveAttendeesFrom, type TemplateLookup } from '../../db/repo/schedule-template'
import type { DbLike } from '../../db/repo/types'
import { semester } from '../../db/schema/calendar'
import { discipline } from '../../db/schema/curriculum'
import { templateEntry } from '../../db/schema/schedule'
import { parseCell, parseTeacherName } from './cell'
import { detectGridLayout, type DetectedLayout } from './detect'

export interface GridImportProblem {
  /** 1-based строка листа. */
  row: number
  groupName: string
  /** Текст ячейки как записан в файле. */
  text: string
  reason: string
}

export interface GridUnknownAbbreviation {
  abbr: string
  count: number
  /** Дисциплины, чьё полное название начинается с тех же букв — подсказка для привязки. */
  suggestions: { id: number; name: string }[]
}

export interface PlannedGridEntry {
  dayOfWeek: number
  pairNo: number
  teachingLoadId: number
  label: string
}

export interface GridImportPlan {
  layout: Pick<DetectedLayout, 'headerRow' | 'unknownHeaders'> & { groups: string[]; cellsCount: number }
  entries: PlannedGridEntry[]
  problems: GridImportProblem[]
  unknownAbbreviations: GridUnknownAbbreviation[]
  /** Записи, конфликтующие друг с другом: они всё равно загружаются, исправить их можно в редакторе. */
  conflicts: string[]
}

export interface GridImportParams {
  semesterId: number
  /** Сокращение (как в файле) → дисциплина; сохраняется в `discipline.short_name`. */
  bindings?: Record<string, number>
  headerRow?: number
}

/** Ключ сокращения: без регистра, пробелов и точек («Неорг. хим.» = «неорг хим»). */
export function abbreviationKey(text: string): string {
  return text.toLowerCase().replace(/[.\s]/g, '')
}

const WEEKDAY = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

/** Занятий в неделю по строке нагрузки (не меньше 1): знаменатель заполненности при выборе строки. */
function weeklyLessons(load: { lessonKind: 'theory' | 'practice' | 'seminar' | 'lab'; hoursPlanned: number; weekFrom: number | null; weekTo: number | null; hoursPerWeek: number | null; sessionHours: number }, ctx: SemesterWeeksContext): number {
  try {
    const r = resolveLoadWeeks(load, ctx)
    return Math.max(1, Math.ceil(r.hoursPerWeek / load.sessionHours))
  } catch {
    return 1
  }
}

export function planGridImport(tx: DbLike, grid: Grid, params: GridImportParams): { plan: GridImportPlan; layout: DetectedLayout; disciplineBindings: Map<number, string> } {
  const sem = tx.select().from(semester).where(eq(semester.id, params.semesterId)).get()
  if (!sem) throw new NotFoundError('semester', params.semesterId)

  const lookup = buildTemplateLookup(tx)
  const groups = [...lookup.groups.values()].filter((g) => g.validTo == null && g.mergedIntoId == null)
  const layout = detectGridLayout(
    grid,
    groups.map((g) => ({ id: g.id, name: g.name })),
    { headerRow: params.headerRow },
  )

  // ── справочники для сопоставления
  const disciplines = [...lookup.disciplines.values()].filter((d) => d.archivedAt == null)
  const byAbbr = new Map<string, number[]>()
  const addAbbr = (key: string, id: number) => byAbbr.set(key, [...(byAbbr.get(key) ?? []), id])
  for (const d of disciplines) {
    if (d.shortName?.trim()) addAbbr(abbreviationKey(d.shortName), d.id)
  }
  const byFullName = new Map<string, number[]>()
  for (const d of disciplines) byFullName.set(abbreviationKey(d.name), [...(byFullName.get(abbreviationKey(d.name)) ?? []), d.id])
  const bound = new Map(Object.entries(params.bindings ?? {}).map(([abbr, id]) => [abbreviationKey(abbr), id]))

  const loads = [...lookup.loads.values()].filter((l) => l.semesterId === params.semesterId && l.validTo == null)
  const disciplineOfLoad = (loadId: number) => {
    const load = lookup.loads.get(loadId)!
    return lookup.rows.get(load.curriculumRowId)?.disciplineId
  }
  const streamsOfGroup = new Map<number, Set<number>>()
  for (const [streamId, members] of lookup.streamMembers) {
    for (const m of members) streamsOfGroup.set(m.groupId, new Set([...(streamsOfGroup.get(m.groupId) ?? []), streamId]))
  }
  const teachers = [...lookup.teachers.values()].filter((t) => t.firedAt == null)

  const weeksCtx = weeksContextOf(sem)
  const problems: GridImportProblem[] = []
  const unknown = new Map<string, number>()
  const planned = new Map<string, PlannedGridEntry>() // load|day|pair
  const perLoad = new Map<number, number>()
  const disciplineBindings = new Map<number, string>()

  for (const cell of layout.cells) {
    const text = [cell.top, cell.bottom].filter(Boolean).join(' / ')
    const fail = (reason: string) => problems.push({ row: cell.row, groupName: cell.groupName, text, reason })
    const parsed = parseCell(cell.top, cell.bottom)
    if (parsed.teacherMismatch) fail('число преподавателей в нижней строке не совпадает с числом занятий в верхней — преподаватель не определён')

    for (const side of parsed.sides) {
      const key = abbreviationKey(side.discipline)
      const bindingId = bound.get(key)
      const ids = bindingId != null ? [bindingId] : (byAbbr.get(key) ?? byFullName.get(key) ?? [])
      if (ids.length === 0) {
        unknown.set(side.discipline, (unknown.get(side.discipline) ?? 0) + 1)
        fail(`неизвестное сокращение «${side.discipline}» — привяжите его к дисциплине`)
        continue
      }
      if (ids.length > 1) {
        fail(`сокращение «${side.discipline}» подходит нескольким дисциплинам — задайте им разные сокращения`)
        continue
      }
      const disciplineId = ids[0]!
      if (bindingId != null) disciplineBindings.set(disciplineId, side.discipline)

      let teacherIds: Set<number> | null = null
      if (side.teacher) {
        const { lastName, initial } = parseTeacherName(side.teacher)
        const found = teachers.filter((t) => t.lastName.toLowerCase() === lastName.toLowerCase() && (initial == null || t.firstName.toLowerCase().startsWith(initial)))
        if (found.length === 0) {
          fail(`преподаватель «${side.teacher}» не найден`)
          continue
        }
        teacherIds = new Set(found.map((t) => t.id))
      }

      const streams = streamsOfGroup.get(cell.groupId) ?? new Set<number>()
      const candidates = loads.filter((l) => {
        if (disciplineOfLoad(l.id) !== disciplineId) return false
        if (teacherIds && !teacherIds.has(l.teacherId)) return false
        if (l.groupId === cell.groupId) {
          const no = l.subgroupId != null ? lookup.subgroups.get(l.subgroupId)?.no : null
          return (side.subgroupNo ?? null) === (no ?? null)
        }
        return l.streamId != null && streams.has(l.streamId) && side.subgroupNo == null
      })
      if (candidates.length === 0) {
        const who = side.subgroupNo != null ? `${cell.groupName}, п/гр ${side.subgroupNo}` : cell.groupName
        fail(`в нагрузке семестра нет строки «${side.discipline}»${side.teacher ? ` у ${side.teacher}` : ''} для ${who}`)
        continue
      }

      // Несколько подходящих строк (лекции и практика одной дисциплины): в ячейке вида занятия нет,
      // поэтому берём строку, у которой меньше всего заполнена её недельная норма. Простой счётчик
      // занятий отдавал бы первое занятие лекции, а второе — практике независимо от часов.
      const fill = (l: (typeof candidates)[number]) => (perLoad.get(l.id) ?? 0) / weeklyLessons(l, weeksCtx)
      // Поточное занятие стоит в колонке каждой группы потока: оно уже занесено в этот слот первой колонкой.
      const inSlot = (l: (typeof candidates)[number]) => (planned.has(`${l.id}|${cell.dayOfWeek}|${cell.pairNo}`) ? 0 : 1)
      candidates.sort((a, b) => inSlot(a) - inSlot(b) || fill(a) - fill(b) || a.id - b.id)
      const load = candidates[0]!
      const slotKey = `${load.id}|${cell.dayOfWeek}|${cell.pairNo}`
      if (planned.has(slotKey)) continue // поточное занятие — одна запись на все колонки потока
      planned.set(slotKey, { dayOfWeek: cell.dayOfWeek, pairNo: cell.pairNo, teachingLoadId: load.id, label: `${side.discipline} (${cell.groupName})` })
      perLoad.set(load.id, (perLoad.get(load.id) ?? 0) + 1)
    }
  }

  const entries = [...planned.values()].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.pairNo - b.pairNo)
  const conflicts = findPlannedConflicts(tx, lookup, entries)

  const unknownAbbreviations: GridUnknownAbbreviation[] = [...unknown.entries()].map(([abbr, count]) => {
    const prefix = abbreviationKey(abbr).slice(0, 3)
    return {
      abbr,
      count,
      suggestions: disciplines
        .filter((d) => abbreviationKey(d.name).startsWith(prefix))
        .slice(0, 5)
        .map((d) => ({ id: d.id, name: d.name })),
    }
  })

  return {
    layout,
    disciplineBindings,
    plan: {
      layout: { headerRow: layout.headerRow, unknownHeaders: layout.unknownHeaders, groups: layout.groupColumns.map((c) => c.header), cellsCount: layout.cells.length },
      entries,
      problems,
      unknownAbbreviations,
      conflicts,
    },
  }
}

/** Авторитетная проверка конфликтов (§5.8) тем же `findConflicts`, что и при ручной постановке. */
function findPlannedConflicts(tx: DbLike, lookup: TemplateLookup, entries: PlannedGridEntry[]): string[] {
  const placed: SlotEntry[] = []
  const labels = new Map<number, string>()
  const messages: string[] = []
  entries.forEach((e, i) => {
    const load = lookup.loads.get(e.teachingLoadId)!
    const candidate: SlotEntry = {
      id: -(i + 1),
      dayOfWeek: e.dayOfWeek,
      pairNo: e.pairNo,
      weekParity: 'all',
      teacherId: load.teacherId,
      roomId: null,
      attendees: resolveAttendeesFrom(lookup, e.teachingLoadId).map((a) => ({ groupId: a.groupId, posFrom: a.posFrom, posTo: a.posTo })),
    }
    labels.set(candidate.id, e.label)
    const found = findConflicts(candidate, placed)
    if (found.length > 0) messages.push(`${WEEKDAY[e.dayOfWeek]}, пара ${e.pairNo}, ${e.label}: ${describeConflicts(found, nameResolver(tx, labels))}`)
    placed.push(candidate)
  })
  return messages
}

export interface GridImportResult {
  templateId: number
  created: number
  plan: GridImportPlan
}

/** Запись внутри `runOperation('import', …)` — откат одним действием убирает и версию, и привязанные сокращения. */
export function applyGridImport(tx: DbLike, grid: Grid, params: GridImportParams, ctx: AuditContext): GridImportResult {
  const { plan, disciplineBindings } = planGridImport(tx, grid, params)
  const sem = tx.select().from(semester).where(eq(semester.id, params.semesterId)).get()!

  // Привязка сокращения запоминается в справочнике: в следующий раз оно распознаётся само.
  for (const [disciplineId, abbr] of disciplineBindings) {
    const d = tx
      .select()
      .from(discipline)
      .where(and(eq(discipline.id, disciplineId), isNull(discipline.archivedAt)))
      .get()
    if (d && (d.shortName ?? '').trim() === '') updateRow(tx, discipline, d.id, { shortName: abbr }, d.rowVersion, ctx)
  }

  const created = createTemplate(tx, { semesterId: params.semesterId, effectiveFrom: sem.startsOn, note: 'Загружено из файла расписания' }, ctx)
  const templateId = created.id as number
  for (const e of plan.entries) {
    createRow(tx, templateEntry, { templateId, dayOfWeek: e.dayOfWeek, pairNo: e.pairNo, teachingLoadId: e.teachingLoadId, roomId: null, weekParity: 'all', isLocked: true, source: 'manual' }, ctx)
  }
  return { templateId, created: plan.entries.length, plan }
}
