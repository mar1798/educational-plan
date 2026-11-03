/**
 * Правило «практика после 80 % лекций» (§этап Г). Это РЕКОМЕНДАЦИЯ, а не запрет (ответ завуча):
 * если лекции к началу практики не пройдены, они продолжают занимать пары, и практику некуда
 * поставить. Поэтому программа предупреждает и помогает подобрать часы, но генерацию не блокирует.
 *
 * Считаются только теоретические занятия (`lesson_kind = 'theory'`): семинары и лабораторные
 * лекциями не являются. Пара «группа/поток × строка плана» проверяется, только если у неё есть
 * и теория, и практика.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { hoursInWeek, resolveLoadWeeks, type LoadWeeksInput, type SemesterWeeksContext } from '../../shared/load/weeks'
import type { LectureCoverageItem, LectureCoverageDraft, LectureHoursSuggestion } from '../../shared/ipc/contract'
import { NotFoundError } from '../db/repo/base-repo'
import { activeGroupLoads, groupHoursByWeek, weeksContextOf } from '../db/repo/teaching-load'
import type { DbLike } from '../db/repo/types'
import { appSetting } from '../db/schema/app-setting'
import { semester } from '../db/schema/calendar'
import { curriculumRow, discipline } from '../db/schema/curriculum'
import { stream, streamMember, teachingLoad } from '../db/schema/load'
import { studyGroup } from '../db/schema/people'

export const SETTING_LECTURE_COVERAGE = 'lecture_coverage_before_practice'
export const DEFAULT_LECTURE_COVERAGE = 80

type LoadRow = typeof teachingLoad.$inferSelect

export function lectureCoverageThreshold(tx: DbLike): number {
  const raw = tx.select().from(appSetting).where(eq(appSetting.key, SETTING_LECTURE_COVERAGE)).get()?.value
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_LECTURE_COVERAGE
}

/** Строка нагрузки в виде, который понимает расчёт; черновик из диалога подменяет сохранённую строку или добавляется к ним. */
function applyDraft(loads: LoadRow[], draft: LectureCoverageDraft | undefined, semesterId: number): LoadRow[] {
  if (!draft) return loads
  const synthetic = {
    id: draft.id ?? -1,
    semesterId,
    curriculumRowId: draft.curriculumRowId,
    teacherId: 0,
    groupId: draft.groupId,
    streamId: draft.streamId,
    divisionSchemeId: null,
    subgroupId: draft.subgroupId ?? null,
    lessonKind: draft.lessonKind,
    hoursPlanned: draft.hoursPlanned,
    weekFrom: draft.weekFrom ?? null,
    weekTo: draft.weekTo ?? null,
    hoursPerWeek: draft.hoursPerWeek ?? null,
  } as LoadRow
  return draft.id != null ? loads.map((l) => (l.id === draft.id ? synthetic : l)) : [...loads, synthetic]
}

interface Pair {
  key: string
  groupId: number | null
  streamId: number | null
  curriculumRowId: number
  theory: LoadRow[]
  practice: LoadRow[]
}

function safeResolve(l: LoadWeeksInput, ctx: SemesterWeeksContext) {
  try {
    return resolveLoadWeeks(l, ctx)
  } catch {
    return null // строка с устаревшими неделями проверку чужой пары не ломает
  }
}

function collectPairs(loads: LoadRow[]): Pair[] {
  const pairs = new Map<string, Pair>()
  for (const l of loads) {
    if (l.lessonKind !== 'theory' && l.lessonKind !== 'practice') continue
    const key = `${l.groupId != null ? `g${l.groupId}` : `s${l.streamId}`}:${l.curriculumRowId}`
    const pair = pairs.get(key) ?? { key, groupId: l.groupId, streamId: l.streamId, curriculumRowId: l.curriculumRowId, theory: [], practice: [] }
    ;(l.lessonKind === 'theory' ? pair.theory : pair.practice).push(l)
    pairs.set(key, pair)
  }
  return [...pairs.values()]
}

/** Подгруппы одной дисциплины делят те же часы, а не прибавляют новые: считаем теорию всей группы, а без неё — как есть. */
function wholeTheory(theory: LoadRow[]): LoadRow[] {
  const whole = theory.filter((l) => l.subgroupId == null)
  return whole.length > 0 ? whole : theory
}

function practiceStart(pair: Pair, ctx: SemesterWeeksContext): number | null {
  const starts = pair.practice.map((p) => safeResolve(p, ctx)?.weekFrom).filter((w): w is number => w != null)
  return starts.length > 0 ? Math.min(...starts) : null
}

function coveredBefore(theory: LoadRow[], ctx: SemesterWeeksContext, week: number): number {
  let sum = 0
  for (const l of theory) {
    const r = safeResolve(l, ctx)
    if (!r) continue
    for (let w = r.weekFrom; w < week && w <= r.weekTo; w++) sum += hoursInWeek(l, r, w)
  }
  return sum
}

export function lectureCoverage(
  tx: DbLike,
  params: { semesterId: number; groupId?: number | null; streamId?: number | null; draft?: LectureCoverageDraft },
): LectureCoverageItem[] {
  const sem = tx.select().from(semester).where(eq(semester.id, params.semesterId)).get()
  if (!sem) throw new NotFoundError('semester', params.semesterId)
  const ctx = weeksContextOf(sem)
  const threshold = lectureCoverageThreshold(tx)

  const loads = applyDraft(
    tx.select().from(teachingLoad).where(and(eq(teachingLoad.semesterId, params.semesterId), isNull(teachingLoad.validTo))).all(),
    params.draft,
    params.semesterId,
  )

  const groups = new Map(tx.select().from(studyGroup).all().map((g) => [g.id, g.name]))
  const streams = new Map(tx.select().from(stream).all().map((s) => [s.id, s.name]))
  const rowDiscipline = new Map(
    tx
      .select({ id: curriculumRow.id, name: discipline.name })
      .from(curriculumRow)
      .innerJoin(discipline, eq(discipline.id, curriculumRow.disciplineId))
      .all()
      .map((r) => [r.id, r.name]),
  )

  const items: LectureCoverageItem[] = []
  for (const pair of collectPairs(loads)) {
    if (params.groupId != null && pair.groupId !== params.groupId) continue
    if (params.streamId != null && pair.streamId !== params.streamId) continue
    if (pair.theory.length === 0 || pair.practice.length === 0) continue

    const startWeek = practiceStart(pair, ctx)
    if (startWeek == null) continue
    const theory = wholeTheory(pair.theory)
    const totalHours = theory.reduce((s, l) => s + l.hoursPlanned, 0)
    if (totalHours <= 0) continue
    const coveredHours = Math.round(coveredBefore(theory, ctx, startWeek) * 10) / 10
    const percent = Math.round((coveredHours / totalHours) * 100)
    const ok = (coveredHours / totalHours) * 100 >= threshold
    const disciplineName = rowDiscipline.get(pair.curriculumRowId) ?? `строка плана #${pair.curriculumRowId}`
    const targetLabel = pair.groupId != null ? (groups.get(pair.groupId) ?? `группа #${pair.groupId}`) : (streams.get(pair.streamId!) ?? `поток #${pair.streamId}`)

    items.push({
      groupId: pair.groupId,
      streamId: pair.streamId,
      curriculumRowId: pair.curriculumRowId,
      targetLabel,
      disciplineName,
      practiceFromWeek: startWeek,
      coveredHours,
      totalHours,
      percent,
      threshold,
      ok,
      message: `${targetLabel}, «${disciplineName}»: к ${startWeek}-й неделе пройдено ${coveredHours} из ${totalHours} ч лекций, ${percent}% (рекомендуется не менее ${threshold}%)`,
    })
  }
  return items.sort((a, b) => Number(a.ok) - Number(b.ok) || a.targetLabel.localeCompare(b.targetLabel, 'ru'))
}

/**
 * Минимальные «часы в неделю» теории (кратные 2), при которых к началу практики пройдено не меньше
 * порога. Если подобранное значение упирается в недельный лимит группы, показывает, сколько не хватает.
 */
export function suggestLectureHours(tx: DbLike, params: { semesterId: number; draft: LectureCoverageDraft }): LectureHoursSuggestion {
  const { draft } = params
  const sem = tx.select().from(semester).where(eq(semester.id, params.semesterId)).get()
  if (!sem) throw new NotFoundError('semester', params.semesterId)
  const ctx = weeksContextOf(sem)
  const threshold = lectureCoverageThreshold(tx)

  if (draft.lessonKind !== 'theory') return { hoursPerWeek: null, fits: true, shortfall: 0, message: 'Подбор нужен только для теоретических занятий' }

  const loads = tx.select().from(teachingLoad).where(and(eq(teachingLoad.semesterId, params.semesterId), isNull(teachingLoad.validTo))).all()
  // Без самой редактируемой строки: подбираем её вклад поверх остальных.
  const others = loads.filter((l) => l.id !== draft.id)
  const pair = collectPairs(others).find((p) => p.curriculumRowId === draft.curriculumRowId && p.groupId === (draft.groupId ?? null) && p.streamId === (draft.streamId ?? null))

  const practiceStarts = (pair?.practice ?? []).map((p) => safeResolve(p, ctx)?.weekFrom).filter((w): w is number => w != null)
  if (practiceStarts.length === 0) return { hoursPerWeek: null, fits: true, shortfall: 0, message: 'У этой дисциплины нет практики — подбирать нечего' }
  const startWeek = Math.min(...practiceStarts)

  const first = draft.weekFrom ?? 1
  const weeksBefore = startWeek - first
  if (weeksBefore < 1) return { hoursPerWeek: null, fits: false, shortfall: 0, message: `Практика начинается с ${startWeek}-й недели — до неё лекциям не остаётся недель` }

  const otherTheory = wholeTheory(pair?.theory ?? [])
  const total = otherTheory.reduce((s, l) => s + l.hoursPlanned, 0) + draft.hoursPlanned
  const needed = Math.ceil((total * threshold) / 100) - coveredBefore(otherTheory, ctx, startWeek)
  const perWeek = Math.max(2, Math.ceil(Math.max(0, needed) / weeksBefore / 2) * 2)
  const hoursPerWeek = Math.min(perWeek, Math.ceil(draft.hoursPlanned / 2) * 2)

  // Недельный лимит каждой группы цели на неделях до практики.
  let shortfall = 0
  const groupsToCheck = draft.groupId != null ? [draft.groupId] : streamGroupIds(tx, draft.streamId!)
  for (const gid of groupsToCheck) {
    const group = tx.select().from(studyGroup).where(eq(studyGroup.id, gid)).get()
    if (!group) continue
    const rest = activeGroupLoads(tx, gid, params.semesterId, draft.id).filter((l) => safeResolve(l, ctx) != null)
    const byWeek = groupHoursByWeek(rest, ctx)
    for (let w = first; w < startWeek; w++) shortfall = Math.max(shortfall, Math.ceil(byWeek[w - 1]! + hoursPerWeek - group.maxHoursPerWeek))
  }

  const fits = shortfall <= 0
  return {
    hoursPerWeek,
    fits,
    shortfall: Math.max(0, shortfall),
    message: fits
      ? `Нужно ${hoursPerWeek} ч/нед, чтобы к ${startWeek}-й неделе пройти не менее ${threshold}% лекций`
      : `Нужно ${hoursPerWeek} ч/нед, но группа выйдет за недельный лимит: не хватает ${shortfall} ч в неделю`,
  }
}

function streamGroupIds(tx: DbLike, streamId: number): number[] {
  return tx
    .select({ groupId: streamMember.groupId })
    .from(streamMember)
    .where(and(eq(streamMember.streamId, streamId), isNull(streamMember.validTo)))
    .all()
    .map((r) => r.groupId)
}
