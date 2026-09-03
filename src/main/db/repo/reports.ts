/**
 * Отчёты этапа 7 (PLAN.md §6 «Этап 7», §1.1 п.22/25/36/39): выполнение нагрузки,
 * вычтенные часы, загрузка кабинетов. Сводное расписание отдельной функции не требует —
 * это уже существующие `exportSummaryScheduleExcel`/`printSummaryScheduleToPdf` (export/*.ts).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { NotFoundError } from './base-repo'
import { studyGroupById } from './schedule-template'
import { normHoursYearOf } from './teaching-load'
import type { DbLike } from './types'
import { academicYear, calendarDay, semester } from '../schema/calendar'
import { discipline } from '../schema/curriculum'
import { teachingLoad } from '../schema/load'
import { pairGrid, room } from '../schema/org'
import { teacher, teacherCategory } from '../schema/people'
import { lesson, lessonGroup } from '../schema/schedule'
import { otherLoad } from '../schema/system'

export interface TeacherLoadReportRow {
  teacherId: number
  teacherName: string
  categoryTitle: string
  planHours: number
  factHours: number
  otherHours: number
  totalHours: number
  normHoursYear: number | null
  shortfallHours: number | null
}

/**
 * План/факт по преподавателю за учебный год (§1.1 п.22, п.25, п.36, п.39):
 * факт — только аудиторные часы, «прочее» входит в итог, но не в недоработку.
 */
export function teacherLoadReport(tx: DbLike, academicYearId: number): TeacherLoadReportRow[] {
  const year = tx.select().from(academicYear).where(eq(academicYear.id, academicYearId)).get()
  if (!year) throw new NotFoundError('academic_year', academicYearId)

  const semesterIds = tx.select({ id: semester.id }).from(semester).where(eq(semester.academicYearId, academicYearId)).all().map((s) => s.id)
  const today = new Date().toISOString().slice(0, 10)
  const teachers = tx.select().from(teacher).all()

  const bySemesters = semesterIds.length > 0 ? inArray(teachingLoad.semesterId, semesterIds) : undefined
  const otherBySemesters = semesterIds.length > 0 ? inArray(otherLoad.semesterId, semesterIds) : undefined

  return teachers.map((t) => {
    const category = tx.select().from(teacherCategory).where(eq(teacherCategory.id, t.categoryId)).get()

    const planHours =
      bySemesters == null
        ? 0
        : tx
            .select({ n: teachingLoad.hoursPlanned })
            .from(teachingLoad)
            .where(and(eq(teachingLoad.teacherId, t.id), bySemesters, isNull(teachingLoad.validTo)))
            .all()
            .reduce((sum, r) => sum + r.n, 0)

    const otherHours =
      otherBySemesters == null
        ? 0
        : tx
            .select({ n: otherLoad.hours })
            .from(otherLoad)
            .where(and(eq(otherLoad.teacherId, t.id), otherBySemesters))
            .all()
            .reduce((sum, r) => sum + r.n, 0)

    // Факт (§1.1 п.22): только planned/held на сегодня и раньше — cancelled вычтено,
    // moved уже «переехало» в новый lesson на своей дате и посчитается там же.
    const fact = tx
      .select()
      .from(lesson)
      .where(eq(lesson.teacherId, t.id))
      .all()
      .filter((l) => (l.status === 'planned' || l.status === 'held') && l.date <= today && l.date >= year.startsOn && l.date <= year.endsOn)
      .reduce((sum, l) => sum + l.academicHours, 0)

    const normHoursYear = normHoursYearOf(category, t.rate)
    const shortfallHours = normHoursYear != null ? Math.max(normHoursYear - fact, 0) : null

    return {
      teacherId: t.id,
      teacherName: `${t.lastName} ${t.firstName}`,
      categoryTitle: category?.titleRu ?? '—',
      planHours,
      factHours: fact,
      otherHours,
      totalHours: fact + otherHours,
      normHoursYear,
      shortfallHours,
    }
  })
}

export interface DeductedHoursRow {
  disciplineId: number
  disciplineName: string
  groupId: number
  groupName: string
  cancelledHours: number
  cancelledCount: number
}

/** Вычтенные (отменённые) часы по дисциплине и группе (§этап 7) — сколько план не выполнен из-за отмен. */
export function deductedHoursReport(tx: DbLike, dateFrom: string, dateTo: string): DeductedHoursRow[] {
  const cancelled = tx
    .select()
    .from(lesson)
    .where(eq(lesson.status, 'cancelled'))
    .all()
    .filter((l) => l.date >= dateFrom && l.date <= dateTo)

  const byKey = new Map<string, DeductedHoursRow>()
  for (const l of cancelled) {
    const attendees = tx.select().from(lessonGroup).where(eq(lessonGroup.lessonId, l.id)).all()
    for (const a of attendees) {
      const key = `${l.disciplineId}:${a.groupId}`
      const existing = byKey.get(key)
      if (existing) {
        existing.cancelledHours += l.academicHours
        existing.cancelledCount += 1
        continue
      }
      const disc = tx.select().from(discipline).where(eq(discipline.id, l.disciplineId)).get()
      const group = studyGroupById(tx, a.groupId)
      byKey.set(key, {
        disciplineId: l.disciplineId,
        disciplineName: disc?.name ?? '—',
        groupId: a.groupId,
        groupName: group?.name ?? `#${a.groupId}`,
        cancelledHours: l.academicHours,
        cancelledCount: 1,
      })
    }
  }

  return [...byKey.values()].sort((a, b) => a.disciplineName.localeCompare(b.disciplineName, 'ru') || a.groupName.localeCompare(b.groupName, 'ru'))
}

export interface RoomUtilizationRow {
  roomId: number
  roomLabel: string
  occupiedSlots: number
  availableSlots: number
  idlePercent: number
}

/** Загрузка кабинетов и простой (§этап 7): доступность считается от факт-дней и включённых пар в сетке звонков. */
export function roomUtilizationReport(tx: DbLike, dateFrom: string, dateTo: string): RoomUtilizationRow[] {
  const studyDays = tx
    .select()
    .from(calendarDay)
    .where(eq(calendarDay.kind, 'study'))
    .all()
    .filter((d) => d.date >= dateFrom && d.date <= dateTo).length

  const enabledPairs = tx.select().from(pairGrid).where(eq(pairGrid.enabled, true)).all().length
  const availableSlots = studyDays * enabledPairs

  const rooms = tx
    .select()
    .from(room)
    .all()
    .filter((r) => r.validFrom <= dateTo && (r.validTo == null || r.validTo >= dateFrom))

  return rooms.map((r) => {
    const roomLessons = tx.select().from(lesson).where(eq(lesson.roomId, r.id)).all()
    const occupiedSlots = new Set(
      roomLessons
        .filter((l) => (l.status === 'planned' || l.status === 'held') && l.date >= dateFrom && l.date <= dateTo)
        .map((l) => `${l.date}#${l.pairNo}`),
    ).size

    return {
      roomId: r.id,
      roomLabel: r.number,
      occupiedSlots,
      availableSlots,
      idlePercent: availableSlots > 0 ? 1 - occupiedSlots / availableSlots : 0,
    }
  })
}
