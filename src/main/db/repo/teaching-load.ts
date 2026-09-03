import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { curriculum, curriculumRow } from '../schema/curriculum'
import { streamMember, teachingLoad } from '../schema/load'
import { studyGroup, teacher, teacherQualification } from '../schema/people'
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
 * Суммарные аудиторные часы группы в семестре (§1.1 п.20, §3.7a): свои строки нагрузки
 * плюс часы потоков, в которых группа участвует, — поток не хранит нагрузку у каждой
 * группы отдельно, поэтому его часы прибавляются через членство.
 */
export function activeGroupTeachingHours(tx: DbLike, groupId: number, semesterId: number, excludeLoadId?: number): number {
  const direct = tx
    .select({ n: sql<number>`coalesce(sum(${teachingLoad.hoursPlanned}), 0)` })
    .from(teachingLoad)
    .where(
      and(
        eq(teachingLoad.groupId, groupId),
        eq(teachingLoad.semesterId, semesterId),
        isNull(teachingLoad.validTo),
        excludeLoadId != null ? sql`${teachingLoad.id} != ${excludeLoadId}` : sql`1=1`,
      ),
    )
    .get() as { n: number }

  const memberStreamIds = tx
    .select({ id: streamMember.streamId })
    .from(streamMember)
    .where(and(eq(streamMember.groupId, groupId), isNull(streamMember.validTo)))
    .all()
    .map((r) => r.id)

  if (memberStreamIds.length === 0) return direct.n

  const viaStreams = tx
    .select({ n: sql<number>`coalesce(sum(${teachingLoad.hoursPlanned}), 0)` })
    .from(teachingLoad)
    .where(
      and(
        inArray(teachingLoad.streamId, memberStreamIds),
        eq(teachingLoad.semesterId, semesterId),
        isNull(teachingLoad.validTo),
        excludeLoadId != null ? sql`${teachingLoad.id} != ${excludeLoadId}` : sql`1=1`,
      ),
    )
    .get() as { n: number }

  return direct.n + viaStreams.n
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

  const t = tx.select().from(teacher).where(eq(teacher.id, input.teacherId)).get()
  if (!t) throw new NotFoundError('teacher', input.teacherId)

  const row = tx.select().from(curriculumRow).where(eq(curriculumRow.id, input.curriculumRowId)).get()
  if (!row) throw new NotFoundError('curriculum_row', input.curriculumRowId)

  if (!isTeacherQualified(tx, input.teacherId, row.disciplineId, validFrom)) {
    throw new LoadValidationError(
      `Преподаватель ${t.lastName} ${t.firstName} не имеет действующей квалификации по этой дисциплине на ${validFrom}`,
    )
  }

  if (input.groupId != null) {
    const group = tx.select().from(studyGroup).where(eq(studyGroup.id, input.groupId)).get()
    if (!group) throw new NotFoundError('study_group', input.groupId)
    const sem = tx.select().from(semester).where(eq(semester.id, input.semesterId)).get()
    if (!sem) throw new NotFoundError('semester', input.semesterId)

    const already = activeGroupTeachingHours(tx, input.groupId, input.semesterId, existing?.id)
    const total = already + input.hoursPlanned
    const limit = group.maxHoursPerWeek * sem.weeksCount
    if (total > limit) {
      throw new LoadValidationError(
        `Группа «${group.name}» выйдет за недельный лимит ${group.maxHoursPerWeek} ч (за семестр это ${limit} ч): будет ${total} ч`,
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
