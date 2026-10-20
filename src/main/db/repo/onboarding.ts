import { eq, gt, isNull, sql } from 'drizzle-orm'
import type { OnboardingStatus, OnboardingStep } from '../../../shared/ipc/contract'
import { academicYear, semester } from '../schema/calendar'
import { curriculum, curriculumRow, discipline } from '../schema/curriculum'
import { teachingLoad } from '../schema/load'
import { pairGrid, room, speciality } from '../schema/org'
import { studyGroup, teacher, teacherQualification } from '../schema/people'
import { scheduleTemplate } from '../schema/schedule'
import type { DbLike } from './types'

/**
 * Экран «С чего начать» (онбординг завуча): что уже заведено и чего не хватает для
 * генерации расписания. Дистрибутив поставляется с пустой базой, а порядок справочников
 * из кода не очевиден — группе нужен учебный план, нагрузке квалификация и т.д. Статус
 * шагов считается здесь, renderer только показывает (граница «бизнес-правило — в main»).
 */

function names(list: string[], limit = 5): string {
  return list.length > limit ? `${list.slice(0, limit).join(', ')} и ещё ${list.length - limit}` : list.join(', ')
}

const REQUIRED_FOR_GENERATION = new Set(['calendar', 'specialities', 'disciplines', 'groups', 'teachers', 'curricula', 'qualifications', 'load', 'rooms'])

export function onboardingStatus(tx: DbLike): OnboardingStatus {
  const steps: OnboardingStep[] = []
  const count = (n: number, noun: string) => `${noun}: ${n}`

  const years = tx.select().from(academicYear).all()
  const semesters = tx.select().from(semester).all()
  steps.push({
    key: 'calendar',
    status: semesters.length > 0 ? 'done' : 'todo',
    summary: `${count(years.length, 'учебных лет')}, ${count(semesters.length, 'семестров')}`,
    issue: years.length > 0 && semesters.length === 0 ? 'в учебном году нет семестров — нагрузка и расписание привязаны к семестру' : null,
  })

  const specialities = tx.select().from(speciality).where(isNull(speciality.archivedAt)).all()
  steps.push({ key: 'specialities', status: specialities.length > 0 ? 'done' : 'todo', summary: count(specialities.length, 'специальностей'), issue: null })

  const disciplines = tx.select({ id: discipline.id }).from(discipline).where(isNull(discipline.archivedAt)).all()
  steps.push({ key: 'disciplines', status: disciplines.length > 0 ? 'done' : 'todo', summary: count(disciplines.length, 'дисциплин'), issue: null })

  const groups = tx.select().from(studyGroup).where(isNull(studyGroup.validTo)).all()
  steps.push({ key: 'groups', status: groups.length > 0 ? 'done' : 'todo', summary: count(groups.length, 'групп'), issue: null })

  const teachers = tx.select().from(teacher).where(isNull(teacher.firedAt)).all()
  steps.push({ key: 'teachers', status: teachers.length > 0 ? 'done' : 'todo', summary: count(teachers.length, 'преподавателей'), issue: null })

  // Группа учится по плану своей специальности и года набора; без строк плана нагрузку
  // некуда привязать (teaching_load.curriculum_row_id).
  const plans = tx.select().from(curriculum).all()
  const planRows = tx.select({ curriculumId: curriculumRow.curriculumId }).from(curriculumRow).where(isNull(curriculumRow.validTo)).all()
  const plansWithRows = new Set(planRows.map((r) => r.curriculumId))
  const groupsWithoutPlan = groups.filter((g) => {
    const plan = plans.find((p) => p.specialityId === g.specialityId && p.admissionYear === g.admissionYear)
    return !plan || !plansWithRows.has(plan.id)
  })
  steps.push({
    key: 'curricula',
    status: groups.length > 0 && groupsWithoutPlan.length === 0 ? 'done' : 'todo',
    summary: `${count(plans.length, 'планов')}, ${count(planRows.length, 'строк')}`,
    issue: groupsWithoutPlan.length > 0 ? `у групп нет учебного плана или он пуст: ${names(groupsWithoutPlan.map((g) => g.name))}` : null,
  })

  const qualifications = tx.select({ teacherId: teacherQualification.teacherId }).from(teacherQualification).where(isNull(teacherQualification.validTo)).all()
  const qualified = new Set(qualifications.map((q) => q.teacherId))
  const unqualified = teachers.filter((t) => !qualified.has(t.id))
  steps.push({
    key: 'qualifications',
    // Квалификация без нагрузки не обязательна каждому (новый почасовик ещё ничего не ведёт),
    // поэтому «у части нет» — повод проверить, а не блокирующий шаг.
    status: qualifications.length === 0 ? 'todo' : unqualified.length > 0 ? 'review' : 'done',
    summary: count(qualifications.length, 'квалификаций'),
    issue: unqualified.length > 0 ? `без квалификаций: ${names(unqualified.map((t) => `${t.lastName} ${t.firstName}`))}` : null,
  })

  const loads = tx.select({ groupId: teachingLoad.groupId }).from(teachingLoad).where(isNull(teachingLoad.validTo)).all()
  const loadedGroups = new Set(loads.map((l) => l.groupId))
  const groupsWithoutLoad = groups.filter((g) => !loadedGroups.has(g.id))
  steps.push({
    key: 'load',
    status: loads.length === 0 ? 'todo' : groupsWithoutLoad.length > 0 ? 'review' : 'done',
    summary: count(loads.length, 'строк нагрузки'),
    issue: loads.length > 0 && groupsWithoutLoad.length > 0 ? `у групп нет нагрузки: ${names(groupsWithoutLoad.map((g) => g.name))}` : null,
  })

  const rooms = tx.select({ id: room.id }).from(room).where(isNull(room.validTo)).all()
  steps.push({ key: 'rooms', status: rooms.length > 0 ? 'done' : 'todo', summary: count(rooms.length, 'кабинетов'), issue: null })

  // Сетка заводится при первом запуске заглушкой 08:00… (решения п. 40): шаг «пройден»,
  // но реальное время звонков нужно сверить, пока хоть одна пара не правилась.
  const pairs = tx.select({ n: sql<number>`count(*)` }).from(pairGrid).where(eq(pairGrid.enabled, true)).get() as { n: number }
  const edited = tx.select({ n: sql<number>`count(*)` }).from(pairGrid).where(gt(pairGrid.rowVersion, 1)).get() as { n: number }
  steps.push({
    key: 'pairGrid',
    status: edited.n > 0 ? 'done' : 'review',
    summary: count(pairs.n, 'пар в день'),
    issue: edited.n > 0 ? null : 'время звонков стоит по умолчанию (08:00–09:30 и далее) — сверьте с колледжем',
  })

  const templates = tx.select({ id: scheduleTemplate.id }).from(scheduleTemplate).where(isNull(scheduleTemplate.effectiveTo)).all()
  steps.push({ key: 'schedule', status: templates.length > 0 ? 'done' : 'todo', summary: count(templates.length, 'шаблонов недели'), issue: null })

  const ready = steps.every((s) => !REQUIRED_FOR_GENERATION.has(s.key) || s.status !== 'todo')
  return { steps, ready }
}
