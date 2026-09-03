import { and, eq, isNull } from 'drizzle-orm'
import type { AuditContext } from '../db/repo/audit'
import { createRow, NotFoundError } from '../db/repo/base-repo'
import { saveTeachingLoad } from '../db/repo/teaching-load'
import type { DbLike } from '../db/repo/types'
import { calendarPeriod, semester } from '../db/schema/calendar'
import { curriculum, curriculumRow, discipline } from '../db/schema/curriculum'
import { studyGroup, teacher, teacherCategory } from '../db/schema/people'
import { cellNumber, cellText, type Cell } from '../../shared/import/engine'

export interface ApplyResult {
  created: number
  skipped: { row: Record<string, Cell>; reason: string }[]
}

/**
 * Применение размеченных строк к конкретным таблицам (§3.8, §3.8e). Разбор колонок
 * (engine.ts) не знает о БД; здесь — обратное: колонки уже сопоставлены с полями,
 * остаётся найти существующие связанные записи (дисциплину, группу, преподавателя)
 * и создать строку, либо пропустить с понятной причиной — импорт не изобретает
 * отсутствующие справочные записи молча.
 */

const TEACHER_CATEGORY_CODES = new Set(['staff', 'external', 'hourly'])

export function applyTeacherRows(tx: DbLike, rows: Record<string, Cell>[], ctx: AuditContext = {}): ApplyResult {
  const categories = tx.select().from(teacherCategory).all()
  const skipped: ApplyResult['skipped'] = []
  let created = 0

  for (const row of rows) {
    const lastName = cellText(row.lastName ?? null)
    const firstName = cellText(row.firstName ?? null)
    if (!lastName || !firstName) {
      skipped.push({ row, reason: 'не указана фамилия или имя' })
      continue
    }
    const categoryCode = cellText(row.categoryCode ?? null) || 'staff'
    if (!TEACHER_CATEGORY_CODES.has(categoryCode)) {
      skipped.push({ row, reason: `неизвестная категория «${categoryCode}»` })
      continue
    }
    const category = categories.find((c) => c.code === categoryCode)
    if (!category) {
      skipped.push({ row, reason: `справочник категорий не заведён (код «${categoryCode}»)` })
      continue
    }

    createRow(
      tx,
      teacher,
      {
        lastName,
        firstName,
        middleName: cellText(row.middleName ?? null) || null,
        categoryId: category.id,
        phone: cellText(row.phone ?? null) || null,
        mainWorkplace: cellText(row.mainWorkplace ?? null) || null,
      },
      ctx,
    )
    created++
  }

  return { created, skipped }
}

const CALENDAR_PERIOD_KINDS = new Set(['theory', 'practice', 'prequal_practice', 'vacation', 'session', 'iga', 'quarantine'])

export function applyCalendarPeriodRows(tx: DbLike, rows: Record<string, Cell>[], ctx: AuditContext = {}): ApplyResult {
  const skipped: ApplyResult['skipped'] = []
  let created = 0

  for (const row of rows) {
    const kind = cellText(row.kind ?? null)
    if (!CALENDAR_PERIOD_KINDS.has(kind)) {
      skipped.push({ row, reason: `неизвестный тип периода «${kind}»` })
      continue
    }
    const startsOn = cellText(row.startsOn ?? null)
    const endsOn = cellText(row.endsOn ?? null)
    if (!startsOn || !endsOn) {
      skipped.push({ row, reason: 'не указана дата начала или окончания' })
      continue
    }

    createRow(
      tx,
      calendarPeriod,
      {
        kind: kind as (typeof calendarPeriod.$inferInsert)['kind'],
        course: cellNumber(row.course ?? null),
        specialityId: null,
        groupId: null,
        startsOn,
        endsOn,
        note: cellText(row.note ?? null) || null,
      },
      ctx,
    )
    created++
  }

  return { created, skipped }
}

export function applyCurriculumRows(
  tx: DbLike,
  curriculumId: number,
  rows: Record<string, Cell>[],
  validFrom: string,
  ctx: AuditContext = {},
): ApplyResult {
  const disciplines = tx.select().from(discipline).all()
  const skipped: ApplyResult['skipped'] = []
  let created = 0

  for (const row of rows) {
    const name = cellText(row.disciplineName ?? null)
    const found = disciplines.find((d) => d.name.trim().toLowerCase() === name.toLowerCase())
    if (!found) {
      skipped.push({ row, reason: `дисциплина «${name}» не найдена в справочнике` })
      continue
    }
    const course = cellNumber(row.course ?? null)
    const semesterNo = cellNumber(row.semesterNo ?? null)
    const credits = cellNumber(row.credits ?? null)
    const hoursTotal = cellNumber(row.hoursTotal ?? null)
    const hoursClassroom = cellNumber(row.hoursClassroom ?? null)
    if (course == null || semesterNo == null || credits == null || hoursTotal == null || hoursClassroom == null) {
      skipped.push({ row, reason: 'не хватает обязательных числовых полей (курс/семестр/кредиты/часы)' })
      continue
    }

    createRow(
      tx,
      curriculumRow,
      {
        curriculumId,
        disciplineId: found.id,
        course,
        semesterNo,
        credits,
        hoursTotal,
        hoursClassroom,
        hoursTheory: cellNumber(row.hoursTheory ?? null) ?? 0,
        hoursPractice: cellNumber(row.hoursPractice ?? null) ?? 0,
        hoursSeminar: cellNumber(row.hoursSeminar ?? null) ?? 0,
        hoursLab: cellNumber(row.hoursLab ?? null) ?? 0,
        hoursSrs: cellNumber(row.hoursSrs ?? null) ?? 0,
        controlSemester: cellNumber(row.controlSemester ?? null),
        validFrom,
      },
      ctx,
    )
    created++
  }

  return { created, skipped }
}

const LESSON_KINDS = new Set(['theory', 'practice', 'seminar', 'lab'])

/**
 * Строка нагрузки из файла резолвится в конкретную curriculum_row через тот же
 * расчёт «курс + полугодие → семестр плана» (§1.1 п.38), что и loadBalanceByGroup —
 * группа уже знает свою специальность, год набора и курс, семестр берётся из семестра импорта.
 */
export function applyTeachingLoadRows(
  tx: DbLike,
  semesterId: number,
  rows: Record<string, Cell>[],
  validFrom: string,
  ctx: AuditContext = {},
): ApplyResult {
  const sem = tx.select().from(semester).where(eq(semester.id, semesterId)).get()
  if (!sem) throw new NotFoundError('semester', semesterId)

  const teachers = tx.select().from(teacher).all()
  const groups = tx.select().from(studyGroup).all()
  const disciplines = tx.select().from(discipline).all()
  const skipped: ApplyResult['skipped'] = []
  let created = 0

  for (const row of rows) {
    const teacherName = cellText(row.teacherName ?? null).toLowerCase()
    const t = teachers.find((x) => `${x.lastName} ${x.firstName}`.toLowerCase() === teacherName)
    if (!t) {
      skipped.push({ row, reason: `преподаватель «${cellText(row.teacherName ?? null)}» не найден (ожидается «Фамилия Имя»)` })
      continue
    }
    const groupName = cellText(row.groupName ?? null)
    const g = groups.find((x) => x.name.toLowerCase() === groupName.toLowerCase())
    if (!g) {
      skipped.push({ row, reason: `группа «${groupName}» не найдена` })
      continue
    }
    const disciplineName = cellText(row.disciplineName ?? null)
    const d = disciplines.find((x) => x.name.toLowerCase() === disciplineName.toLowerCase())
    if (!d) {
      skipped.push({ row, reason: `дисциплина «${disciplineName}» не найдена` })
      continue
    }
    const lessonKind = cellText(row.lessonKind ?? null)
    if (!LESSON_KINDS.has(lessonKind)) {
      skipped.push({ row, reason: `неизвестный вид занятия «${lessonKind}»` })
      continue
    }
    const hoursPlanned = cellNumber(row.hoursPlanned ?? null)
    if (hoursPlanned == null || hoursPlanned <= 0) {
      skipped.push({ row, reason: 'часы не указаны' })
      continue
    }

    const planSemesterNo = (g.course - 1) * 2 + sem.no
    const plan = tx
      .select()
      .from(curriculum)
      .where(and(eq(curriculum.specialityId, g.specialityId), eq(curriculum.admissionYear, g.admissionYear)))
      .get()
    if (!plan) {
      skipped.push({ row, reason: `нет учебного плана для специальности группы «${g.name}» и года набора ${g.admissionYear}` })
      continue
    }
    const planRow = tx
      .select()
      .from(curriculumRow)
      .where(
        and(
          eq(curriculumRow.curriculumId, plan.id),
          eq(curriculumRow.disciplineId, d.id),
          eq(curriculumRow.course, g.course),
          eq(curriculumRow.semesterNo, planSemesterNo),
          isNull(curriculumRow.validTo),
        ),
      )
      .get()
    if (!planRow) {
      skipped.push({ row, reason: `в плане нет строки «${disciplineName}» для курса ${g.course}, семестра ${planSemesterNo}` })
      continue
    }

    try {
      saveTeachingLoad(
        tx,
        {
          semesterId,
          curriculumRowId: planRow.id,
          teacherId: t.id,
          groupId: g.id,
          streamId: null,
          divisionSchemeId: null,
          subgroupId: null,
          lessonKind: lessonKind as 'theory' | 'practice' | 'seminar' | 'lab',
          hoursPlanned,
          requiresParallel: false,
          roomTypeRequired: null,
          clinicalModeOverride: null,
          note: null,
        },
        validFrom,
        null,
        ctx,
      )
      created++
    } catch (e) {
      skipped.push({ row, reason: e instanceof Error ? e.message : 'ошибка сохранения' })
    }
  }

  return { created, skipped }
}
