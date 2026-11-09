import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { hoursInWeek, lectureFirstWeeks, resolveLoadWeeks, type LoadWeeksInput, type SemesterWeeksContext, type SequencedLoadInput } from '../../../shared/load/weeks'
import { curriculum, curriculumRow } from '../schema/curriculum'
import { stream, streamMember, teachingLoad } from '../schema/load'
import { divisionScheme, studyGroup, subgroup, teacher, teacherQualification } from '../schema/people'
import { semester } from '../schema/calendar'
import { otherLoad } from '../schema/system'
import type { AuditContext } from './audit'
import { createRow, NotFoundError, updateRow } from './base-repo'
import type { DbLike } from './types'

export class LoadValidationError extends Error {}

/** Активна ли квалификация преподавателя по дисциплине на дату (§2.3, §3.5). */
export function isTeacherQualified(tx: DbLike, teacherId: number, disciplineId: number, onDate: string): boolean {
  const rows = tx
    .select({ id: teacherQualification.id })
    .from(teacherQualification)
    .where(
      and(
        eq(teacherQualification.teacherId, teacherId),
        eq(teacherQualification.disciplineId, disciplineId),
        sql`${teacherQualification.validFrom} <= ${onDate}`,
        sql`(${teacherQualification.validTo} is null or ${teacherQualification.validTo} >= ${onDate})`,
      ),
    )
    .all()
  return rows.length > 0
}

/**
 * Действующие строки нагрузки группы в семестре (§1.1 п.20, §3.7a): свои строки плюс строки
 * потоков, в которых группа участвует, — поток не хранит нагрузку у каждой группы отдельно,
 * поэтому его часы прибавляются через членство.
 */
export function activeGroupLoads(tx: DbLike, groupId: number, semesterId: number, excludeLoadId?: number): (typeof teachingLoad.$inferSelect)[] {
  const memberStreamIds = tx
    .select({ id: streamMember.streamId })
    .from(streamMember)
    .where(and(eq(streamMember.groupId, groupId), isNull(streamMember.validTo)))
    .all()
    .map((r) => r.id)

  const target = memberStreamIds.length > 0 ? or(eq(teachingLoad.groupId, groupId), inArray(teachingLoad.streamId, memberStreamIds)) : eq(teachingLoad.groupId, groupId)
  return tx
    .select()
    .from(teachingLoad)
    .where(and(target, eq(teachingLoad.semesterId, semesterId), isNull(teachingLoad.validTo), excludeLoadId != null ? sql`${teachingLoad.id} != ${excludeLoadId}` : sql`1=1`))
    .all()
}

/** Суммарные аудиторные часы группы в семестре (§1.1 п.20, §3.7a). */
export function activeGroupTeachingHours(tx: DbLike, groupId: number, semesterId: number, excludeLoadId?: number): number {
  return activeGroupLoads(tx, groupId, semesterId, excludeLoadId).reduce((sum, l) => sum + l.hoursPlanned, 0)
}

type SemesterRow = typeof semester.$inferSelect

export function weeksContextOf(sem: SemesterRow): SemesterWeeksContext {
  return { weeksCount: sem.weeksCount, practiceStartWeek: sem.practiceStartWeek }
}

type LoadRow = typeof teachingLoad.$inferSelect

/** Группы, которые слушают строку: своя группа или действующие участники потока. */
export function loadGroupsResolver(tx: DbLike): (load: { groupId: number | null; streamId: number | null }) => number[] {
  const members = new Map<number, number[]>()
  for (const m of tx.select().from(streamMember).where(isNull(streamMember.validTo)).all()) {
    members.set(m.streamId, [...(members.get(m.streamId) ?? []), m.groupId])
  }
  return (l) => (l.groupId != null ? [l.groupId] : (members.get(l.streamId!) ?? []))
}

/**
 * Действующие строки нагрузки семестра с неделями «сначала лекции» (решение 53). Все, кто считает
 * недели (снимок солвера, фазы, лимит, раскатка, проверка лекций), обязаны брать строки отсюда —
 * иначе фаза и снимок разойдутся в том, где идёт практика.
 *
 * `excludeId` убирает сохранённую версию правимой строки, `extra` добавляет черновик: так проверка
 * лимита при сохранении видит ту же расстановку, что получит генерация.
 */
export function effectiveSemesterLoads<T extends SequencedLoadInput & { id: number; groupId: number | null; streamId: number | null } = LoadRow>(
  tx: DbLike,
  sem: SemesterRow,
  opts: { excludeId?: number; extra?: T[] } = {},
): T[] {
  const saved = tx
    .select()
    .from(teachingLoad)
    .where(and(eq(teachingLoad.semesterId, sem.id), isNull(teachingLoad.validTo)))
    .all()
    .filter((l) => l.id !== opts.excludeId) as unknown as T[]
  return lectureFirstWeeks([...saved, ...(opts.extra ?? [])], loadGroupsResolver(tx), weeksContextOf(sem))
}

/**
 * Часы группы по учебным неделям семестра (индекс 0 — первая неделя). Нужны для недельного
 * лимита (п. 20): в фазе, где лекции и практика идут вместе, нагрузка выше средней за семестр,
 * и проверка по сумме часов этого не увидела бы.
 */
export function groupHoursByWeek(loads: LoadWeeksInput[], ctx: SemesterWeeksContext): number[] {
  const weeks = new Array<number>(ctx.weeksCount).fill(0)
  for (const l of loads) {
    const resolved = resolveLoadWeeks(l, ctx)
    for (let w = resolved.weekFrom; w <= resolved.weekTo; w++) weeks[w - 1]! += hoursInWeek(l, resolved, w)
  }
  return weeks
}

export interface TeachingLoadInput {
  semesterId: number
  curriculumRowId: number
  teacherId: number
  groupId: number | null
  streamId: number | null
  divisionSchemeId: number | null
  subgroupId: number | null
  lessonKind: 'theory' | 'practice' | 'seminar' | 'lab'
  hoursPlanned: number
  // Необязательны: вызовы без недель (импорт, сид) означают «как раньше».
  weekFrom?: number | null
  weekTo?: number | null
  hoursPerWeek?: number | null
  sessionHours: 2 | 4 | 6
  requiresParallel: boolean
  roomTypeRequired: string | null
  clinicalModeOverride: 'full_day' | 'block' | 'free' | null
  note: string | null
}

/**
 * Сохранение строки нагрузки (§3.5, §3.6, §3.6a, §3.7a). Ровно одно из group/stream
 * задано (§4.3); квалификация преподавателя — жёсткое ограничение («нельзя назначить»),
 * недельный лимит группы 45 ч — тоже жёсткое (§1.1 п.20), контроль max_hours_year
 * преподавателя — предупреждение, не блокировка (возвращается вызывающей стороне).
 */
export function saveTeachingLoad(
  tx: DbLike,
  input: TeachingLoadInput,
  validFrom: string,
  existing: { id: number; rowVersion: number } | null,
  ctx: AuditContext = {},
): { row: Record<string, unknown>; teacherHoursOverYear: number | null } {
  if ((input.groupId == null) === (input.streamId == null)) {
    throw new LoadValidationError('Укажите либо группу, либо поток — ровно один вариант')
  }

  // Длинными бывают только практические занятия (п. 48); у остальных видов 4–6 часов
  // подряд — ошибка ввода, а не особый режим.
  if (input.lessonKind !== 'practice' && input.sessionHours !== 2) {
    throw new LoadValidationError('Длительность 4 или 6 часов бывает только у практических занятий')
  }

  // Параллельные подгруппы (§4.3 pairedLoadId) идут в одни и те же пары: при разной длине одна
  // подгруппа сидела бы без занятия, а snapshot связку таких строк молча не строит.
  if (existing) {
    const current = tx.select().from(teachingLoad).where(eq(teachingLoad.id, existing.id)).get()
    const partner = current?.pairedLoadId != null ? tx.select().from(teachingLoad).where(eq(teachingLoad.id, current.pairedLoadId)).get() : undefined
    if (partner && partner.sessionHours !== input.sessionHours) {
      throw new LoadValidationError(
        `У параллельной подгруппы занятие длится ${partner.sessionHours} ч — длительность у пары подгрупп должна совпадать`,
      )
    }
  }

  const t = tx.select().from(teacher).where(eq(teacher.id, input.teacherId)).get()
  if (!t) throw new NotFoundError('teacher', input.teacherId)

  const row = tx.select().from(curriculumRow).where(eq(curriculumRow.id, input.curriculumRowId)).get()
  if (!row) throw new NotFoundError('curriculum_row', input.curriculumRowId)

  const sem = tx.select().from(semester).where(eq(semester.id, input.semesterId)).get()
  if (!sem) throw new NotFoundError('semester', input.semesterId)

  const targetGroups = loadTargetGroups(tx, input)
  assertPlanRowFits(tx, row, targetGroups, sem.no)

  if (!isTeacherQualified(tx, input.teacherId, row.disciplineId, validFrom)) {
    throw new LoadValidationError(
      `Преподаватель ${t.lastName} ${t.firstName} не имеет действующей квалификации по этой дисциплине на ${validFrom}`,
    )
  }

  // Недели действия: ошибка ввода (за пределами семестра, начало позже конца) — до записи.
  const weeksCtx = weeksContextOf(sem)
  resolveLoadWeeks(input, weeksCtx)

  // Недельный лимит (п. 20) проверяется по каждой неделе отдельно: у группы с лекциями и практикой
  // в одной фазе нагрузка выше средней, и сумма за семестр этого не показывает.
  // Недели берутся с расстановкой «сначала лекции» по всему семестру (решение 53): иначе проверка
  // видела бы лекции на 18 неделях, а генерация — сжатыми в начало, и лимит считался бы не о том.
  const draftId = -1
  const groupsOf = loadGroupsResolver(tx)
  const before = effectiveSemesterLoads(tx, sem)
  const after = effectiveSemesterLoads(tx, sem, { excludeId: existing?.id, extra: [{ ...input, id: draftId } as unknown as LoadRow] })
  const draftGroupIds = new Set(targetGroups.map((g) => g.id))
  const belongs = (l: LoadRow, groupId: number) => (l.id === draftId ? draftGroupIds.has(groupId) : groupsOf(l).includes(groupId))
  const peakOf = (loads: LoadRow[], groupId: number) => {
    const resolvable = loads.filter((l) => {
      if (!belongs(l, groupId)) return false
      try {
        resolveLoadWeeks(l, weeksCtx)
        return true
      } catch {
        return false // уже сохранённая строка с устаревшими неделями не должна блокировать правку другой
      }
    })
    const byWeek = groupHoursByWeek(resolvable, weeksCtx)
    const peak = Math.max(...byWeek)
    return { peak, week: byWeek.indexOf(peak) + 1 }
  }

  for (const group of targetGroups) {
    const { peak, week } = peakOf(after, group.id)
    if (peak > group.maxHoursPerWeek) {
      throw new LoadValidationError(`Группа «${group.name}» выйдет за недельный лимит ${group.maxHoursPerWeek} ч: в неделе ${week} будет ${Math.round(peak * 10) / 10} ч`)
    }
  }

  // Правка одной группы может сдвинуть недели соседей по потоку: лекция потока заканчивается раньше
  // или позже, и с ней — их практика. Таких соседей тоже проверяем, но только на ухудшение: давнее
  // превышение у чужой группы не повод отказывать в правке этой.
  const beforeById = new Map(before.map((l) => [l.id, l]))
  const shifted = new Set<number>()
  for (const l of after) {
    const b = beforeById.get(l.id)
    if (b && (b.weekFrom !== l.weekFrom || b.weekTo !== l.weekTo)) for (const g of groupsOf(l)) shifted.add(g)
  }
  for (const gid of shifted) {
    if (draftGroupIds.has(gid)) continue
    const group = tx.select().from(studyGroup).where(eq(studyGroup.id, gid)).get()
    if (!group) continue
    const now = peakOf(after, gid)
    if (now.peak > group.maxHoursPerWeek && now.peak > peakOf(before, gid).peak) {
      throw new LoadValidationError(
        `Из-за этой правки у группы «${group.name}» сдвинутся недели (лекции идут раньше практики), и она выйдет за недельный лимит ${group.maxHoursPerWeek} ч: в неделе ${now.week} будет ${Math.round(now.peak * 10) / 10} ч`,
      )
    }
  }

  const values = { ...input, validFrom }
  const saved = existing
    ? updateRow(tx, teachingLoad, existing.id, values, existing.rowVersion, ctx)
    : createRow(tx, teachingLoad, values, ctx)

  let teacherHoursOverYear: number | null = null
  if (t.maxHoursYear != null) {
    const total = totalTeacherHours(tx, input.teacherId)
    if (total > t.maxHoursYear) teacherHoursOverYear = total
  }

  return { row: saved, teacherHoursOverYear }
}

type StudyGroupRow = typeof studyGroup.$inferSelect

/** Группа или действующие участники потока; поток обязан быть из того же полугодия. */
function targetGroupsOf(tx: DbLike, target: { semesterId: number; groupId: number | null; streamId: number | null }): StudyGroupRow[] {
  if (target.streamId != null) {
    const s = tx.select().from(stream).where(eq(stream.id, target.streamId)).get()
    if (!s) throw new NotFoundError('stream', target.streamId)
    if (s.semesterId !== target.semesterId) {
      throw new LoadValidationError(`Поток «${s.name}» создан в другом полугодии — выберите поток этого полугодия`)
    }
    return tx
      .select({ g: studyGroup })
      .from(streamMember)
      .innerJoin(studyGroup, eq(studyGroup.id, streamMember.groupId))
      .where(and(eq(streamMember.streamId, s.id), isNull(streamMember.validTo)))
      .all()
      .map((r) => r.g)
  }
  if (target.groupId == null) return []
  const group = tx.select().from(studyGroup).where(eq(studyGroup.id, target.groupId)).get()
  if (!group) throw new NotFoundError('study_group', target.groupId)
  return [group]
}

/**
 * Группы, на которые ложится нагрузка, плюс проверка подгруппы: она берётся только из
 * схемы деления этой группы и не ставится на поток — иначе при расформировании потока
 * (§3.5a) чужая подгруппа расползалась по группам-участницам.
 */
function loadTargetGroups(tx: DbLike, input: TeachingLoadInput): StudyGroupRow[] {
  const groups = targetGroupsOf(tx, input)
  if (input.streamId != null) {
    if (input.divisionSchemeId != null || input.subgroupId != null) {
      throw new LoadValidationError('Подгруппу можно указать только у нагрузки группы, у потока занимаются все группы целиком')
    }
    return groups
  }

  const group = groups[0]!
  if ((input.divisionSchemeId == null) !== (input.subgroupId == null)) {
    throw new LoadValidationError('Подгруппа указывается вместе со схемой деления')
  }
  if (input.subgroupId != null) {
    const sg = tx.select().from(subgroup).where(eq(subgroup.id, input.subgroupId)).get()
    if (!sg) throw new NotFoundError('subgroup', input.subgroupId)
    const scheme = tx.select().from(divisionScheme).where(eq(divisionScheme.id, input.divisionSchemeId!)).get()
    if (!scheme) throw new NotFoundError('division_scheme', input.divisionSchemeId!)
    if (scheme.groupId !== group.id || sg.schemeId !== scheme.id) {
      throw new LoadValidationError(`Подгруппа не из схемы деления группы «${group.name}»`)
    }
  }
  return [group]
}

/**
 * Строка плана «своя» для группы — тот же инвариант, по которому её подбирает импорт
 * годовой нагрузки: план специальности и года набора группы, её курс и
 * `plan_semester_no = (курс − 1) × 2 + полугодие` (решение п. 38). Одна функция и для
 * проверки при записи, и для списка выбора в диалоге — расходиться им нельзя.
 */
function planRowFits(
  plan: typeof curriculum.$inferSelect | undefined,
  row: typeof curriculumRow.$inferSelect,
  g: StudyGroupRow,
  halfYear: number,
): boolean {
  return (
    plan != null &&
    plan.specialityId === g.specialityId &&
    plan.admissionYear === g.admissionYear &&
    row.course === g.course &&
    row.semesterNo === (g.course - 1) * 2 + halfYear
  )
}

/** У потока строка должна подходить каждому участнику — так держится «одна строка плана на весь поток» (решение п. 27). */
function assertPlanRowFits(tx: DbLike, row: typeof curriculumRow.$inferSelect, groups: StudyGroupRow[], halfYear: number): void {
  const plan = tx.select().from(curriculum).where(eq(curriculum.id, row.curriculumId)).get()
  for (const g of groups) {
    if (!planRowFits(plan, row, g, halfYear)) {
      const planSemesterNo = (g.course - 1) * 2 + halfYear
      throw new LoadValidationError(
        `Строка плана не подходит группе «${g.name}»: нужна строка из плана её специальности и года набора ${g.admissionYear}, курс ${g.course}, семестр ${planSemesterNo}`,
      )
    }
  }
}

/**
 * Строки плана, которые можно назначить группе или потоку в полугодии. Без этого диалог
 * нагрузки показывал все ~500 строк всех планов с одинаковыми подписями, и найти «свою»
 * можно было только перебором до ответа сервера.
 */
export function planRowOptions(
  tx: DbLike,
  target: { semesterId: number; groupId: number | null; streamId: number | null },
): (typeof curriculumRow.$inferSelect)[] {
  const sem = tx.select().from(semester).where(eq(semester.id, target.semesterId)).get()
  if (!sem) throw new NotFoundError('semester', target.semesterId)
  const groups = targetGroupsOf(tx, target)
  const first = groups[0]
  if (!first) return []

  const plans = tx
    .select()
    .from(curriculum)
    .where(and(eq(curriculum.specialityId, first.specialityId), eq(curriculum.admissionYear, first.admissionYear)))
    .all()
  if (plans.length === 0) return []
  const rows = tx
    .select()
    .from(curriculumRow)
    .where(
      and(
        inArray(
          curriculumRow.curriculumId,
          plans.map((p) => p.id),
        ),
        isNull(curriculumRow.validTo),
      ),
    )
    .all()
  const planById = new Map(plans.map((p) => [p.id, p]))
  return rows.filter((r) => groups.every((g) => planRowFits(planById.get(r.curriculumId), r, g, sem.no)))
}

/**
 * Годовая норма преподавателя (§1.1 п.39): 720 ч **на ставку**, и только у штатных —
 * у внештатных и почасовиков `norm_hours_year` категории пуста, норма отсутствует, и
 * отчёт показывает им факт без недоработки. `teacher.max_hours_year` здесь намеренно
 * не участвует: это потолок «больше не давать», а не норма «столько надо выработать».
 */
export function normHoursYearOf(category: { normHoursYear: number | null } | undefined, rate: number): number | null {
  if (category?.normHoursYear == null) return null
  return Math.round(category.normHoursYear * rate)
}

/** Все часы преподавателя за все семестры: строки нагрузки (поток — одна строка) + прочие часы (§1.1 п.36, п.39). */
export function totalTeacherHours(tx: DbLike, teacherId: number): number {
  const load = tx
    .select({ n: sql<number>`coalesce(sum(${teachingLoad.hoursPlanned}), 0)` })
    .from(teachingLoad)
    .where(and(eq(teachingLoad.teacherId, teacherId), isNull(teachingLoad.validTo)))
    .get() as { n: number }
  const other = tx
    .select({ n: sql<number>`coalesce(sum(${otherLoad.hours}), 0)` })
    .from(otherLoad)
    .where(eq(otherLoad.teacherId, teacherId))
    .get() as { n: number }
  return load.n + other.n
}

export interface GroupBalanceRow {
  groupId: number
  groupName: string
  plannedHours: number
  assignedHours: number
  remainingHours: number
  maxHoursPerWeek: number
  limitHours: number
}

/** «Сколько часов плана ещё не распределено» по группам семестра (§3.7). */
export function loadBalanceByGroup(tx: DbLike, semesterId: number): GroupBalanceRow[] {
  const sem = tx.select().from(semester).where(eq(semester.id, semesterId)).get()
  if (!sem) throw new NotFoundError('semester', semesterId)

  const groups = tx.select().from(studyGroup).where(isNull(studyGroup.validTo)).all()
  const result: GroupBalanceRow[] = []

  for (const group of groups) {
    const planSemesterNo = (group.course - 1) * 2 + sem.no
    const plan = tx
      .select()
      .from(curriculum)
      .where(and(eq(curriculum.specialityId, group.specialityId), eq(curriculum.admissionYear, group.admissionYear)))
      .orderBy(sql`case when ${curriculum.status} = 'approved' then 0 else 1 end`, sql`${curriculum.id} desc`)
      .get()

    const plannedHours = plan
      ? ((tx
          .select({ n: sql<number>`coalesce(sum(${curriculumRow.hoursClassroom}), 0)` })
          .from(curriculumRow)
          .where(
            and(
              eq(curriculumRow.curriculumId, plan.id),
              eq(curriculumRow.course, group.course),
              eq(curriculumRow.semesterNo, planSemesterNo),
              isNull(curriculumRow.validTo),
            ),
          )
          .get() as { n: number }).n)
      : 0

    const assignedHours = activeGroupTeachingHours(tx, group.id, semesterId)
    result.push({
      groupId: group.id,
      groupName: group.name,
      plannedHours,
      assignedHours,
      remainingHours: plannedHours - assignedHours,
      maxHoursPerWeek: group.maxHoursPerWeek,
      limitHours: group.maxHoursPerWeek * sem.weeksCount,
    })
  }

  return result
}

export interface TeacherBalanceRow {
  teacherId: number
  teacherName: string
  assignedHours: number
  otherHours: number
  totalHours: number
  normHoursYear: number | null
  overNorm: boolean
}

/** «Сколько набрано» по преподавателям (§3.7): норма считается только у штатных (§1.1 п.39). */
export function loadBalanceByTeacher(tx: DbLike, semesterId: number): TeacherBalanceRow[] {
  const teachers = tx.select().from(teacher).all()
  const result: TeacherBalanceRow[] = []

  for (const t of teachers) {
    const assigned = tx
      .select({ n: sql<number>`coalesce(sum(${teachingLoad.hoursPlanned}), 0)` })
      .from(teachingLoad)
      .where(and(eq(teachingLoad.teacherId, t.id), eq(teachingLoad.semesterId, semesterId), isNull(teachingLoad.validTo)))
      .get() as { n: number }
    const other = tx
      .select({ n: sql<number>`coalesce(sum(${otherLoad.hours}), 0)` })
      .from(otherLoad)
      .where(and(eq(otherLoad.teacherId, t.id), eq(otherLoad.semesterId, semesterId)))
      .get() as { n: number }
    const totalHours = assigned.n + other.n
    result.push({
      teacherId: t.id,
      teacherName: `${t.lastName} ${t.firstName}`,
      assignedHours: assigned.n,
      otherHours: other.n,
      totalHours,
      normHoursYear: t.maxHoursYear,
      overNorm: t.maxHoursYear != null && totalTeacherHours(tx, t.id) > t.maxHoursYear,
    })
  }

  return result
}
