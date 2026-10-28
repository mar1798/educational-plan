import { z } from 'zod'

/**
 * Русские названия полей входных схем. Нужны там, где ошибку видно не рядом с полем:
 * сводка ошибок формы и сообщение main о непрошедшей проверке. Без них завуч получал
 * «Некорректные данные: Invalid input» и не мог понять, что именно поправить.
 */
export const FIELD_LABEL: Record<string, string> = {
  academicHours: 'Академические часы',
  academicYearId: 'Учебный год',
  address: 'Адрес',
  admissionYear: 'Год набора',
  archived: 'Архив',
  availabilityNote: 'Заметка о доступности',
  block: 'Блок',
  bounds: 'Границы',
  buildingId: 'Здание',
  capacity: 'Вместимость',
  categoryId: 'Категория',
  clinicalMode: 'Режим клинической базы',
  clinicalModeOverride: 'Режим клинической базы',
  cmcId: 'ЦМК',
  code: 'Код',
  controlSemester: 'Форма контроля',
  copyFromTemplateId: 'Копировать из версии',
  course: 'Курс',
  credits: 'Кредиты',
  curriculumId: 'Учебный план',
  curriculumRowId: 'Дисциплина (строка плана)',
  cycle: 'Цикл',
  date: 'Дата',
  dateFrom: 'Дата начала',
  dateTo: 'Дата окончания',
  dayOfWeek: 'День недели',
  defaultRoomType: 'Тип кабинета по умолчанию',
  difficulty: 'Сложность',
  disciplineId: 'Дисциплина',
  divisionSchemeId: 'Схема деления',
  effectiveFrom: 'Действует с',
  enabled: 'Включено',
  endsAt: 'Окончание',
  endsOn: 'Дата окончания',
  firedAt: 'Дата увольнения',
  firstName: 'Имя',
  fromCurriculumId: 'Исходный план',
  funding: 'Финансирование',
  groupId: 'Группа',
  groupIds: 'Группы',
  hiredAt: 'Дата приёма',
  hours: 'Часы',
  hoursClassroom: 'Аудиторные часы',
  hoursLab: 'Лабораторные часы',
  hoursPlanned: 'Часы',
  hoursPractice: 'Практические часы',
  hoursSeminar: 'Семинарские часы',
  hoursSrs: 'Часы СРС',
  hoursTheory: 'Теоретические часы',
  hoursTotal: 'Всего часов',
  indexCode: 'Индекс',
  isClinical: 'Клиническая база',
  isDefault: 'По умолчанию',
  isLocked: 'Закреплено',
  kind: 'Вид',
  lastName: 'Фамилия',
  lessonId: 'Занятие',
  lessonKind: 'Вид занятия',
  mainWorkplace: 'Основное место работы',
  mappingJson: 'Сопоставление колонок',
  maxHoursPerWeek: 'Часов в неделю, не более',
  maxHoursYear: 'Годовая норма часов',
  maxPairsPerDay: 'Пар в день, не более',
  mergeDate: 'Дата слияния',
  middleName: 'Отчество',
  movedFromDate: 'Перенесено с даты',
  name: 'Название',
  newDate: 'Новая дата',
  newPairNo: 'Новая пара',
  newRoomId: 'Новый кабинет',
  no: 'Номер',
  note: 'Заметка',
  number: 'Номер',
  pairFrom: 'Первая пара',
  pairNo: 'Пара',
  pairTo: 'Последняя пара',
  part: 'Часть',
  partsCount: 'Число частей',
  phone: 'Телефон',
  posFrom: 'С позиции',
  posTo: 'По позицию',
  qualification: 'Квалификация',
  rate: 'Ставка',
  reason: 'Причина',
  requiresClinical: 'Нужна клиническая база',
  requiresParallel: 'Параллельно с подгруппами',
  roomId: 'Кабинет',
  roomTypeRequired: 'Требуемый тип кабинета',
  rows: 'Строки',
  schemeId: 'Схема деления',
  scope: 'Охват',
  semesterId: 'Семестр',
  semesterNo: 'Семестр',
  semestersTotal: 'Всего семестров',
  sessionHours: 'Длительность занятия',
  sourceGroupId: 'Исходная группа',
  specialityId: 'Специальность',
  startsAt: 'Начало',
  startsOn: 'Дата начала',
  status: 'Статус',
  streamId: 'Поток',
  studentsCount: 'Число студентов',
  subgroupId: 'Подгруппа',
  substituteTeacherId: 'Заменяющий преподаватель',
  targetGroupId: 'Группа-приёмник',
  teacherId: 'Преподаватель',
  teachingLoadId: 'Строка нагрузки',
  templateId: 'Версия шаблона',
  validFrom: 'Действует с',
  validTo: 'Действует по',
  weekCount: 'Число недель',
  weeks: 'Недели',
  weeksCount: 'Число недель',
  weight: 'Вес',
}

/** Последний строковый сегмент пути: у `rows.3.hours` подпись берётся от `hours`. */
export function fieldLabel(path: readonly PropertyKey[]): string | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const seg = path[i]
    if (typeof seg === 'string') return FIELD_LABEL[seg] ?? null
  }
  return null
}

export function describeIssue(issue: { path: readonly PropertyKey[]; message: string }): string {
  const label = fieldLabel(issue.path)
  if (!label) return issue.message
  // Сообщения из схем написаны с заглавной («Укажите часы»); после тире — со строчной,
  // кроме аббревиатур вроде «ЦМК».
  const m = issue.message
  const tail = m.length > 1 && m[1] === m[1]!.toUpperCase() && m[1] !== m[1]!.toLowerCase() ? m : m.charAt(0).toLowerCase() + m.slice(1)
  return `«${label}» — ${tail}`
}

/**
 * Встроенная русская локаль zod говорит языком типов («ожидалось, что string будет иметь
 * >=1 символ»), поэтому типовые случаи переписаны по-человечески; остальное — локаль.
 * Ставится один раз в точке входа и main, и renderer: схемы общие, а конфиг zod глобален
 * на процесс.
 */
export function installRuValidationMessages(): void {
  z.config(z.locales.ru())
  z.config({
    customError: (iss) => {
      if (iss.code === 'invalid_type' && (iss.input === undefined || iss.input === null || iss.input === '')) {
        return 'не заполнено'
      }
      if (iss.code === 'invalid_type' && iss.expected === 'number') return 'нужно число'
      // `.int()` в zod 4 падает как invalid_type с expected 'int' — без этой ветки завуч
      // видел «ожидалось int, получено число».
      if (iss.code === 'invalid_type' && iss.expected === 'int') return 'нужно целое число'
      if (iss.code === 'too_small') {
        const min = Number(iss.minimum)
        if (iss.origin === 'string') return min <= 1 ? 'не заполнено' : `не короче ${min} символов`
        if (iss.origin === 'array' || iss.origin === 'set') return min <= 1 ? 'выберите хотя бы одно значение' : `выберите не меньше ${min}`
        if (iss.origin === 'number') return iss.inclusive ? `не меньше ${min}` : `больше ${min}`
      }
      if (iss.code === 'too_big') {
        const max = Number(iss.maximum)
        if (iss.origin === 'string') return `не длиннее ${max} символов`
        if (iss.origin === 'number') return iss.inclusive ? `не больше ${max}` : `меньше ${max}`
      }
      if (iss.code === 'invalid_value') return 'выберите значение из списка'
      if (iss.code === 'invalid_format') return 'неверный формат'
      return undefined
    },
  })
}
