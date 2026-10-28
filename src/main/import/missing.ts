import { and, eq, isNull } from 'drizzle-orm'
import type { ImportMissingReport } from '../../shared/ipc/contract'
import { LESSON_KIND_SYNONYMS, cellNumber, cellText, matchesPersonName, parseEnum, parseHalfYear, type Cell } from '../../shared/import/engine'
import { SPECIALITY_CATALOG, parseGroupName, splitPersonName } from '../../shared/import/references'
import type { AuditContext } from '../db/repo/audit'
import { createRow, NotFoundError } from '../db/repo/base-repo'
import { syncGroupSchemes } from '../db/repo/division-scheme'
import { isTeacherQualified } from '../db/repo/teaching-load'
import type { DbLike } from '../db/repo/types'
import { academicYear, semester } from '../db/schema/calendar'
import { curriculum, curriculumRow, discipline } from '../db/schema/curriculum'
import { speciality } from '../db/schema/org'
import { studyGroup, teacher, teacherCategory, teacherQualification } from '../db/schema/people'

/**
 * «Завести недостающее» для нагрузки из файла (шаг 5 мастера). Импорт сам справочники не
 * изобретает (решения п. 5, docs/import-export.md): без этого шага файл годовой нагрузки на
 * пустой базе давал сотни пропущенных строк. Здесь то же, но явно: сначала отчёт «чего не
 * хватает», затем — по кнопке и после подтверждения — создание одной операцией.
 *
 * Сопоставление с существующими записями — то же, что у applyTeachingLoadRows: иначе отчёт
 * обещал бы одно, а применение находило бы другое.
 */

const DEFAULT_STUDENTS_COUNT = 25
const LESSON_KINDS = ['theory', 'practice', 'seminar', 'lab'] as const
type LessonKind = (typeof LESSON_KINDS)[number]

function key(...parts: (string | number)[]): string {
  return parts.map((p) => String(p).trim().toLowerCase()).join('\u0000')
}

interface PlannedRow {
  curriculum: string
  specialityCode: string
  admissionYear: number
  disciplineName: string
  course: number
  semesterNo: number
  /** Часы по видам для каждой группы плана: у групп одного плана они должны совпадать. */
  byGroup: Map<string, Record<LessonKind, number>>
}

interface Plan {
  report: ImportMissingReport
  rows: PlannedRow[]
  firstDate: string
}

function planMissing(tx: DbLike, semesterId: number, rows: Record<string, Cell>[], validFrom: string): Plan {
  const sem = tx.select().from(semester).where(eq(semester.id, semesterId)).get()
  if (!sem) throw new NotFoundError('semester', semesterId)
  const year = tx.select().from(academicYear).where(eq(academicYear.id, sem.academicYearId)).get()
  if (!year) throw new NotFoundError('academic_year', sem.academicYearId)
  const startYear = Number(year.startsOn.slice(0, 4))
  // Справочные записи заводятся с начала учебного года: квалификация «с сегодняшнего дня»
  // не покрыла бы занятия сентября, если завуч загружает файл в октябре.
  const firstDate = year.startsOn < validFrom ? year.startsOn : validFrom

  const specialities = tx.select().from(speciality).all()
  const disciplines = tx.select().from(discipline).all()
  const teachers = tx.select().from(teacher).all()
  const groups = tx.select().from(studyGroup).all()
  const curricula = tx.select().from(curriculum).all()
  const specialityCodes = [...new Set([...specialities.map((s) => s.code), ...SPECIALITY_CATALOG.map((s) => s.code)])]

  const report: ImportMissingReport = {
    specialities: [],
    disciplines: [],
    teachers: [],
    groups: [],
    curricula: [],
    curriculumRows: [],
    qualifications: [],
    problems: [],
  }
  const problems = new Set<string>()
  const plannedRows = new Map<string, PlannedRow>()
  const plannedQualifications = new Set<string>()
  const groupCounts = new Map<string, Map<number, number>>()
  const plannedGroups = new Map<string, ImportMissingReport['groups'][number]>()
  let incomplete = 0

  for (const row of rows) {
    const teacherText = cellText(row.teacherName ?? null)
    const groupText = cellText(row.groupName ?? null)
    const disciplineText = cellText(row.disciplineName ?? null)
    if (teacherText === '' || groupText === '' || disciplineText === '') {
      incomplete++
      continue
    }
    const half = cellText(row.halfYear ?? null) === '' ? sem.no : parseHalfYear(row.halfYear ?? null)
    if (half == null) continue // такую строку отбросит и применение — с причиной

    // Сначала все проверки строки, и только потом — в отчёт: иначе строка, которую применение
    // всё равно отбросит («СД-41» за сроком обучения), заводила бы группу, преподавателя и
    // дисциплину, на которые ничего не сошлётся.

    // Преподаватель: существующий, уже запланированный или новый из «Фамилия И.».
    const existingTeacher = teachers.find((t) => matchesPersonName(teacherText, t.lastName, t.firstName))
    let teacherKey: string | null = existingTeacher ? `id:${existingTeacher.id}` : null
    let newTeacher: ImportMissingReport['teachers'][number] | null = null
    if (!existingTeacher) {
      const planned = report.teachers.find((t) => matchesPersonName(teacherText, t.lastName, t.firstName))
      if (planned) {
        teacherKey = key(planned.lastName, planned.firstName)
      } else {
        const parts = splitPersonName(teacherText)
        if (!parts) {
          problems.add(`преподаватель «${teacherText}»: не удалось разобрать фамилию и имя`)
        } else {
          newTeacher = { source: teacherText, ...parts }
          teacherKey = key(parts.lastName, parts.firstName)
        }
      }
    }

    const existingDiscipline = disciplines.find((d) => key(d.name) === key(disciplineText))

    // Группа: существующая или новая по разбору имени (решения п. 41).
    const existingGroup = groups.find((g) => key(g.name) === key(groupText))
    let specialityCode: string
    let course: number
    let admissionYear: number
    let newGroup: ImportMissingReport['groups'][number] | null = null
    if (existingGroup) {
      const spec = specialities.find((s) => s.id === existingGroup.specialityId)!
      specialityCode = spec.code
      course = existingGroup.course
      admissionYear = existingGroup.admissionYear
    } else {
      const parsed = parseGroupName(groupText, specialityCodes)
      if (!parsed) {
        problems.add(`группа «${groupText}»: не разобрать имя — ожидается код специальности и курс, например «СД-21» или «КСД-21»`)
        continue
      }
      specialityCode = parsed.specialityCode
      course = parsed.course
      admissionYear = startYear - (course - 1)
      newGroup = {
        name: groupText,
        specialityCode,
        course,
        admissionYear,
        funding: parsed.funding,
        studentsCount: DEFAULT_STUDENTS_COUNT,
        studentsCountDefaulted: true,
      }
    }

    const spec = specialities.find((s) => s.code.toUpperCase() === specialityCode.toUpperCase())
    const catalogSpec = SPECIALITY_CATALOG.find((s) => s.code === specialityCode.toUpperCase())
    const semestersTotal = spec?.semestersTotal ?? catalogSpec?.semestersTotal ?? 6
    const semesterNo = (course - 1) * 2 + half
    if (semesterNo > semestersTotal) {
      problems.add(`группа «${groupText}»: ${semesterNo}-й семестр больше срока обучения специальности (${semestersTotal})`)
      continue
    }

    if (newTeacher) report.teachers.push(newTeacher)
    if (!existingDiscipline && !report.disciplines.some((d) => key(d.name) === key(disciplineText))) {
      report.disciplines.push({ name: disciplineText })
    }
    if (newGroup) {
      const counts = groupCounts.get(key(groupText)) ?? new Map<number, number>()
      const students = cellNumber(row.studentsCount ?? null)
      if (students != null && students > 0) counts.set(students, (counts.get(students) ?? 0) + 1)
      groupCounts.set(key(groupText), counts)
      if (!plannedGroups.has(key(groupText))) plannedGroups.set(key(groupText), newGroup)
    }
    if (!spec && catalogSpec && !report.specialities.some((s) => s.code === catalogSpec.code)) {
      report.specialities.push({ code: catalogSpec.code, name: catalogSpec.name })
    }

    // Учебный план специальности и года набора, строка плана на семестр.
    const plan = spec ? curricula.find((c) => c.specialityId === spec.id && c.admissionYear === admissionYear) : undefined
    const planName = plan?.name ?? `${specialityCode}, набор ${admissionYear}`
    if (!plan && !report.curricula.some((c) => c.name === planName)) report.curricula.push({ name: planName })
    const planRowExists =
      plan != null &&
      existingDiscipline != null &&
      tx
        .select({ id: curriculumRow.id })
        .from(curriculumRow)
        .where(
          and(
            eq(curriculumRow.curriculumId, plan.id),
            eq(curriculumRow.disciplineId, existingDiscipline.id),
            eq(curriculumRow.course, course),
            eq(curriculumRow.semesterNo, semesterNo),
            isNull(curriculumRow.validTo),
          ),
        )
        .get() != null
    const lessonKind = parseEnum(row.lessonKind ?? null, LESSON_KINDS, LESSON_KIND_SYNONYMS)
    const hours = cellNumber(row.hoursPlanned ?? null)
    if (!planRowExists) {
      const rowKey = key(planName, disciplineText, course, semesterNo)
      const planned = plannedRows.get(rowKey) ?? {
        curriculum: planName,
        specialityCode,
        admissionYear,
        disciplineName: existingDiscipline?.name ?? disciplineText,
        course,
        semesterNo,
        byGroup: new Map(),
      }
      const perGroup = planned.byGroup.get(key(groupText)) ?? { theory: 0, practice: 0, seminar: 0, lab: 0 }
      if (lessonKind && hours != null && hours > 0) perGroup[lessonKind] += hours
      planned.byGroup.set(key(groupText), perGroup)
      plannedRows.set(rowKey, planned)
    }

    // Квалификация: без неё saveTeachingLoad откажет строке нагрузки. Проверяем на ту же дату,
    // что и он (validFrom), а не на начало года: квалификация «с 1 октября» при импорте с
    // 20 октября уже годится, и вторая — пересекающаяся, «с 1 сентября» — была бы дублем.
    if (teacherKey) {
      const qualified = existingTeacher && existingDiscipline && isTeacherQualified(tx, existingTeacher.id, existingDiscipline.id, validFrom)
      const qKey = key(teacherKey, disciplineText)
      if (!qualified && !plannedQualifications.has(qKey)) {
        plannedQualifications.add(qKey)
        const shown = existingTeacher ? `${existingTeacher.lastName} ${existingTeacher.firstName}` : teacherText
        report.qualifications.push({ teacher: shown, disciplineName: existingDiscipline?.name ?? disciplineText })
      }
    }
  }

  // Численность новой группы — из файла. Разные числа для одной группы — ошибка файла,
  // молча не берётся ни одно (решения п. 43): группа не заводится, пока завуч не выберет.
  for (const [gKey, group] of plannedGroups) {
    const counts = [...(groupCounts.get(gKey) ?? new Map<number, number>())].sort((a, b) => b[1] - a[1])
    if (counts.length > 1) {
      problems.add(
        `группа «${group.name}»: численность в файле расходится (${counts.map(([n, c]) => `${n} в ${c} строках`).join(', ')}) — выберите значение в «Проверке расхождений» выше`,
      )
      continue
    }
    if (counts.length === 1) report.groups.push({ ...group, studentsCount: counts[0]![0], studentsCountDefaulted: false })
    else report.groups.push(group)
  }

  report.curriculumRows = [...plannedRows.values()].map((r) => ({
    curriculum: r.curriculum,
    disciplineName: r.disciplineName,
    course: r.course,
    semesterNo: r.semesterNo,
    hoursClassroom: Object.values(maxHours(r)).reduce((a, h) => a + h, 0),
  }))
  if (incomplete > 0) problems.add(`записей без преподавателя, группы или дисциплины: ${incomplete} — проверьте сопоставление колонок`)
  report.problems = [...problems]
  return { report, rows: [...plannedRows.values()], firstDate }
}

/**
 * Часы строки плана по видам — максимум по группам плана: группы одной специальности и
 * года набора учатся по одному плану, и строка плана не должна оказаться меньше нагрузки
 * какой-то из них (иначе баланс нагрузки сразу покажет перерасход).
 */
function maxHours(row: PlannedRow): Record<LessonKind, number> {
  const result: Record<LessonKind, number> = { theory: 0, practice: 0, seminar: 0, lab: 0 }
  for (const hours of row.byGroup.values()) {
    for (const k of LESSON_KINDS) result[k] = Math.max(result[k], hours[k])
  }
  return result
}

export function previewMissingReferences(tx: DbLike, semesterId: number, rows: Record<string, Cell>[], validFrom: string): ImportMissingReport {
  return planMissing(tx, semesterId, rows, validFrom).report
}

/**
 * Создаёт всё из отчёта previewMissingReferences — план пересчитывается здесь же, внутри
 * транзакции: отчёт, показанный в мастере, мог устареть, а renderer не источник истины.
 * Порядок — по зависимостям: специальности → дисциплины → преподаватели → группы → планы →
 * строки планов → квалификации.
 */
export function createMissingReferences(
  tx: DbLike,
  semesterId: number,
  rows: Record<string, Cell>[],
  validFrom: string,
  ctx: AuditContext = {},
): number {
  const { report, rows: plannedRows, firstDate } = planMissing(tx, semesterId, rows, validFrom)
  let created = 0

  for (const s of report.specialities) {
    const catalog = SPECIALITY_CATALOG.find((c) => c.code === s.code)!
    createRow(tx, speciality, { code: s.code, name: s.name, semestersTotal: catalog.semestersTotal }, ctx)
    created++
  }
  // Блок, цикл и часть дисциплины в файле нагрузки не записаны — те же значения, что
  // предлагает форма дисциплины; мастер предупреждает, что их стоит проверить.
  for (const d of report.disciplines) {
    createRow(tx, discipline, { name: d.name, block: 1, cycle: 'spo3', part: 'base' }, ctx)
    created++
  }
  // Категория «штат» заводится при каждом запуске (ensureTeacherCategories); если её всё же
  // удалили — любая существующая, завуч поправит в карточке.
  const staff = tx.select().from(teacherCategory).where(eq(teacherCategory.code, 'staff')).get() ?? tx.select().from(teacherCategory).get()
  if (report.teachers.length > 0 && !staff) throw new Error('Справочник категорий преподавателей пуст — заведите категорию «Штат»')
  for (const t of report.teachers) {
    createRow(tx, teacher, { lastName: t.lastName, firstName: t.firstName, middleName: t.middleName, categoryId: staff!.id }, ctx)
    created++
  }

  const specialities = tx.select().from(speciality).all()
  const specialityId = (code: string) => specialities.find((s) => s.code.toUpperCase() === code.toUpperCase())!.id
  for (const g of report.groups) {
    const row = createRow(
      tx,
      studyGroup,
      {
        name: g.name,
        specialityId: specialityId(g.specialityCode),
        admissionYear: g.admissionYear,
        course: g.course,
        studentsCount: g.studentsCount,
        funding: g.funding,
        validFrom: firstDate,
      },
      ctx,
    )
    syncGroupSchemes(tx, row.id as number, ctx)
    created++
  }

  const planIds = new Map<string, number>()
  for (const r of plannedRows) {
    if (planIds.has(r.curriculum)) continue
    const existing = tx
      .select()
      .from(curriculum)
      .where(and(eq(curriculum.specialityId, specialityId(r.specialityCode)), eq(curriculum.admissionYear, r.admissionYear)))
      .get()
    if (existing) {
      planIds.set(r.curriculum, existing.id)
      continue
    }
    const plan = createRow(tx, curriculum, { specialityId: specialityId(r.specialityCode), admissionYear: r.admissionYear, name: r.curriculum }, ctx)
    planIds.set(r.curriculum, Number(plan.id))
    created++
  }

  const disciplines = tx.select().from(discipline).all()
  for (const r of plannedRows) {
    const hours = maxHours(r)
    const classroom = hours.theory + hours.practice + hours.seminar + hours.lab
    const d = disciplines.find((x) => key(x.name) === key(r.disciplineName))!
    // Кредиты выводятся из часов (1 кредит = 30 ч, решения п. 31): точнее файл нагрузки
    // не знает, план заводится черновиком и правится в редакторе плана.
    createRow(
      tx,
      curriculumRow,
      {
        curriculumId: planIds.get(r.curriculum)!,
        disciplineId: d.id,
        course: r.course,
        semesterNo: r.semesterNo,
        credits: Math.round(classroom / 30),
        hoursTotal: classroom,
        hoursClassroom: classroom,
        hoursTheory: hours.theory,
        hoursPractice: hours.practice,
        hoursSeminar: hours.seminar,
        hoursLab: hours.lab,
        hoursSrs: 0,
        controlSemester: null,
        validFrom: firstDate,
      },
      ctx,
    )
    created++
  }

  const teachers = tx.select().from(teacher).all()
  for (const q of report.qualifications) {
    const t = teachers.find((x) => matchesPersonName(q.teacher, x.lastName, x.firstName))!
    const d = disciplines.find((x) => key(x.name) === key(q.disciplineName))!
    createRow(tx, teacherQualification, { teacherId: t.id, disciplineId: d.id, validFrom: firstDate }, ctx)
    created++
  }
  return created
}
