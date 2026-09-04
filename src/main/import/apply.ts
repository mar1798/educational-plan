import { and, eq, isNull } from 'drizzle-orm'
import type { AuditContext } from '../db/repo/audit'
import { createRow, NotFoundError } from '../db/repo/base-repo'
import { saveTeachingLoad } from '../db/repo/teaching-load'
import type { DbLike } from '../db/repo/types'
import { calendarPeriod, semester } from '../db/schema/calendar'
import { curriculum, curriculumRow, discipline } from '../db/schema/curriculum'
import { studyGroup, teacher, teacherCategory } from '../db/schema/people'
import { teachingLoad } from '../db/schema/load'
import {
  CALENDAR_KIND_SYNONYMS,
  LESSON_KIND_SYNONYMS,
  TEACHER_CATEGORY_SYNONYMS,
  cellNumber,
  cellText,
  matchesPersonName,
  parseEnum,
  parseIsoDate,
  type Cell,
} from '../../shared/import/engine'

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

const TEACHER_CATEGORY_CODES = ['staff', 'external', 'hourly'] as const

/**
 * Ключ «уже есть»: импорт файла дважды (а завуч повторяет его, поправив пару строк)
 * заводил вторые копии тех же людей и строк — уникальности в БД на них нет. Повтор
 * теперь не создаётся, а попадает в пропущенные с причиной, и файл можно перезаливать.
 */
function sameKey(...parts: (string | number | null)[]): string {
  return parts.map((p) => (p == null ? '' : String(p).trim().toLowerCase())).join('\u0000')
}

export function applyTeacherRows(tx: DbLike, rows: Record<string, Cell>[], ctx: AuditContext = {}): ApplyResult {
  const categories = tx.select().from(teacherCategory).all()
  const seen = new Set(
    tx
      .select()
      .from(teacher)
      .all()
      .map((t) => sameKey(t.lastName, t.firstName, t.middleName)),
  )
  const skipped: ApplyResult['skipped'] = []
  let created = 0

  for (const row of rows) {
    const lastName = cellText(row.lastName ?? null)
    const firstName = cellText(row.firstName ?? null)
    if (!lastName || !firstName) {
      skipped.push({ row, reason: 'не указана фамилия или имя' })
      continue
    }
    // Категория принимается и кодом (`hourly`), и по-русски: названием из справочника
    // («Почасовик») или обиходным синонимом («штат», «внештат»). Файл колледжа ведётся
    // по-русски, и раньше нормальная строка отбивалась как «неизвестная категория».
    const categoryText = cellText(row.categoryCode ?? null)
    const byTitle = categories.find((c) => c.titleRu.trim().toLowerCase() === categoryText.trim().toLowerCase())
    const categoryCode = categoryText === '' ? 'staff' : (byTitle?.code ?? parseEnum(categoryText, TEACHER_CATEGORY_CODES, TEACHER_CATEGORY_SYNONYMS))
    if (categoryCode == null) {
      skipped.push({ row, reason: `неизвестная категория «${categoryText}»` })
      continue
    }
    const category = categories.find((c) => c.code === categoryCode)
    if (!category) {
      skipped.push({ row, reason: `справочник категорий не заведён (код «${categoryCode}»)` })
      continue
    }

    const middleName = cellText(row.middleName ?? null) || null
    const key = sameKey(lastName, firstName, middleName)
    if (seen.has(key)) {
      skipped.push({ row, reason: `${lastName} ${firstName} уже есть в справочнике` })
      continue
    }
    seen.add(key)

    createRow(
      tx,
      teacher,
      {
        lastName,
        firstName,
        middleName,
        categoryId: category.id,
        phone: cellText(row.phone ?? null) || null,
        mainWorkplace: cellText(row.mainWorkplace ?? null) || null,
        availabilityNote: cellText(row.availabilityNote ?? null) || null,
      },
      ctx,
    )
    created++
  }

  return { created, skipped }
}

const CALENDAR_PERIOD_KINDS = ['theory', 'practice', 'prequal_practice', 'vacation', 'session', 'iga', 'quarantine'] as const

export function applyCalendarPeriodRows(tx: DbLike, rows: Record<string, Cell>[], ctx: AuditContext = {}): ApplyResult {
  const seen = new Set(
    tx
      .select()
      .from(calendarPeriod)
      .all()
      .map((p) => sameKey(p.kind, p.course, p.startsOn, p.endsOn)),
  )
  const skipped: ApplyResult['skipped'] = []
  let created = 0

  for (const row of rows) {
    const kind = parseEnum(row.kind ?? null, CALENDAR_PERIOD_KINDS, CALENDAR_KIND_SYNONYMS)
    if (kind == null) {
      skipped.push({ row, reason: `неизвестный тип периода «${cellText(row.kind ?? null)}»` })
      continue
    }
    const startsOn = parseIsoDate(row.startsOn ?? null)
    const endsOn = parseIsoDate(row.endsOn ?? null)
    if (!startsOn || !endsOn) {
      const shown = [cellText(row.startsOn ?? null), cellText(row.endsOn ?? null)].filter((x) => x !== '').join(' — ')
      skipped.push({ row, reason: shown === '' ? 'не указана дата начала или окончания' : `дата не распознана: «${shown}» (ожидается ГГГГ-ММ-ДД или ДД.ММ.ГГГГ)` })
      continue
    }
    if (endsOn < startsOn) {
      skipped.push({ row, reason: `дата окончания ${endsOn} раньше даты начала ${startsOn}` })
      continue
    }

    const course = cellNumber(row.course ?? null)
    const key = sameKey(kind, course, startsOn, endsOn)
    if (seen.has(key)) {
      skipped.push({ row, reason: `такой период уже есть в календаре (${startsOn} — ${endsOn})` })
      continue
    }
    seen.add(key)

    createRow(
      tx,
      calendarPeriod,
      {
        kind,
        course,
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
  const seen = new Set(
    tx
      .select()
      .from(curriculumRow)
      .where(and(eq(curriculumRow.curriculumId, curriculumId), isNull(curriculumRow.validTo)))
      .all()
      .map((r) => sameKey(r.disciplineId, r.course, r.semesterNo)),
  )
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

    const key = sameKey(found.id, course, semesterNo)
    if (seen.has(key)) {
      skipped.push({ row, reason: `«${found.name}» уже есть в этом плане на ${course} курсе, семестр ${semesterNo}` })
      continue
    }
    seen.add(key)

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

const LESSON_KINDS = ['theory', 'practice', 'seminar', 'lab'] as const

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
  const seen = new Set(
    tx
      .select()
      .from(teachingLoad)
      .where(and(eq(teachingLoad.semesterId, semesterId), isNull(teachingLoad.validTo)))
      .all()
      .map((l) => sameKey(l.curriculumRowId, l.teacherId, l.groupId, l.subgroupId, l.lessonKind)),
  )
  const skipped: ApplyResult['skipped'] = []
  let created = 0

  for (const row of rows) {
    const t = teachers.find((x) => matchesPersonName(row.teacherName ?? null, x.lastName, x.firstName))
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
    const lessonKind = parseEnum(row.lessonKind ?? null, LESSON_KINDS, LESSON_KIND_SYNONYMS)
    if (lessonKind == null) {
      skipped.push({ row, reason: `неизвестный вид занятия «${cellText(row.lessonKind ?? null)}»` })
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

    // Ключ без подгруппы: импорт заводит нагрузку на группу целиком, и повторная заливка
    // того же файла иначе удваивала часы, а затем упиралась в недельный лимит группы.
    const key = sameKey(planRow.id, t.id, g.id, null, lessonKind)
    if (seen.has(key)) {
      skipped.push({ row, reason: `у ${t.lastName} ${t.firstName} уже есть такая нагрузка по «${disciplineName}» в группе «${g.name}»` })
      continue
    }
    seen.add(key)

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
          lessonKind,
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
