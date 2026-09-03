import { z } from 'zod'

export const settingsGetInput = z.object({ key: z.string().min(1) })
export const settingsGetOutput = z.object({ value: z.string().nullable() })

export const settingsSetInput = z.object({ key: z.string().min(1), value: z.string() })
export const settingsSetOutput = z.object({ ok: z.literal(true) })

export const generationStartInput = z.object({
  templateId: z.number().int().positive(),
  seed: z.number().int().optional(),
  timeBudgetMs: z.number().int().positive().optional(),
})
export const generationCancelInput = z.object({ jobId: z.string() })
export const generationApplyInput = z.object({ jobId: z.string() })

const operationKind = z.enum(['generate', 'rollout', 'import', 'bulk_edit', 'restore'])

export const operationsListInput = z.object({ kind: operationKind.optional() })
export const operationsUndoInput = z.object({ operationId: z.number().int().positive() })

export const auditEntityInput = z.object({ entity: z.string().min(1), id: z.number().int().positive() })

export const backupListInput = z.object({})
export const backupCreateInput = z.object({ reason: z.literal('manual') })
export const backupRestoreInput = z.object({ fileName: z.string().min(1) })
export const backupExternalCopyInput = z.object({})
export const backupExternalStatusInput = z.object({})

// Справочники (§2.2). Одна схема на сущность используется дважды: как валидация
// IPC-входа в main и как resolver формы в renderer (react-hook-form + @hookform/resolvers/zod).
const withOptimisticId = z.object({
  id: z.number().int().positive().optional(),
  rowVersion: z.number().int().positive().optional(),
})

function requireRowVersionOnUpdate<T extends { id?: number; rowVersion?: number }>(v: T, ctx: z.RefinementCtx) {
  if (v.id != null && v.rowVersion == null) {
    ctx.addIssue({ code: 'custom', message: 'rowVersion обязателен при обновлении', path: ['rowVersion'] })
  }
}

/** Период задом наперёд — самая частая опечатка в датах, ловим до записи в БД. */
function requireOrderedRange<T extends { startsOn: string; endsOn: string }>(v: T, ctx: z.RefinementCtx) {
  if (v.startsOn > v.endsOn) {
    ctx.addIssue({ code: 'custom', message: 'Дата окончания раньше даты начала', path: ['endsOn'] })
  }
}

export const specialitiesListInput = z.object({ includeArchived: z.boolean().optional() })

export const specialitySaveInput = withOptimisticId
  .extend({
    code: z.string().min(1, 'Укажите код специальности'),
    name: z.string().min(1, 'Укажите название'),
    qualification: z.string().nullable(),
    semestersTotal: z.number().int().min(1, 'Минимум 1 семестр').max(12, 'Максимум 12 семестров'),
  })
  .superRefine(requireRowVersionOnUpdate)

export const specialityArchiveInput = z.object({
  id: z.number().int().positive(),
  rowVersion: z.number().int().positive(),
  archived: z.boolean(),
})

export const cmcListInput = z.object({})

export const cmcSaveInput = withOptimisticId
  .extend({ name: z.string().min(1, 'Укажите название ЦМК') })
  .superRefine(requireRowVersionOnUpdate)

export const cmcDeleteInput = z.object({ id: z.number().int().positive() })

export const buildingsListInput = z.object({})

export const buildingSaveInput = withOptimisticId
  .extend({
    name: z.string().min(1, 'Укажите название корпуса'),
    address: z.string().nullable(),
    isClinical: z.boolean(),
    clinicalMode: z.enum(['full_day', 'block', 'free']).nullable(),
  })
  .superRefine(requireRowVersionOnUpdate)

export const buildingDeleteInput = z.object({ id: z.number().int().positive() })

const roomType = z.enum(['lecture', 'practice', 'seminar', 'lab', 'phantom', 'computer', 'gym'])

export const roomsListInput = z.object({ buildingId: z.number().int().positive().optional(), includeClosed: z.boolean().optional() })

export const roomSaveInput = withOptimisticId
  .extend({
    buildingId: z.number().int().positive('Выберите корпус'),
    number: z.string().min(1, 'Укажите номер кабинета'),
    name: z.string().nullable(),
    capacity: z.number().int().positive().nullable(),
    roomType,
    validFrom: z.string().min(1, 'Укажите дату начала действия'),
  })
  .superRefine(requireRowVersionOnUpdate)

export const roomCloseInput = z.object({
  id: z.number().int().positive(),
  rowVersion: z.number().int().positive(),
  // null — вновь открыть ранее закрытый кабинет (симметрично архивации специальности).
  validTo: z.string().min(1).nullable(),
})

export const roomDeleteInput = z.object({ id: z.number().int().positive() })

// Дисциплины (§2.7) — понадобились раньше по плану, чем ожидалось: квалификации
// преподавателя (§2.3) ссылаются на дисциплину, поэтому справочник дисциплин делаем
// вместе с преподавателями в этом слайсе (полноценный сгруппированный экран — тоже 2.7).
export const disciplinesListInput = z.object({ includeArchived: z.boolean().optional() })

export const disciplineSaveInput = withOptimisticId
  .extend({
    name: z.string().min(1, 'Укажите название дисциплины'),
    indexCode: z.string().nullable(),
    block: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    cycle: z.enum(['spo1', 'spo2', 'spo3', 'spo4', 'spo5']),
    part: z.enum(['base', 'elective']),
    difficulty: z.number().int().min(1, 'От 1 до 5').max(5, 'От 1 до 5'),
    defaultRoomType: roomType.nullable(),
    requiresClinical: z.boolean(),
  })
  .superRefine(requireRowVersionOnUpdate)

export const disciplineArchiveInput = z.object({
  id: z.number().int().positive(),
  rowVersion: z.number().int().positive(),
  archived: z.boolean(),
})

export const teacherCategoriesListInput = z.object({})

// Преподаватели (§2.3).
export const teachersListInput = z.object({ includeFired: z.boolean().optional() })

export const teacherSaveInput = withOptimisticId
  .extend({
    lastName: z.string().min(1, 'Укажите фамилию'),
    firstName: z.string().min(1, 'Укажите имя'),
    middleName: z.string().nullable(),
    cmcId: z.number().int().positive().nullable(),
    categoryId: z.number().int().positive('Выберите категорию'),
    rate: z.number().positive('Ставка должна быть больше 0'),
    maxHoursYear: z.number().int().positive().nullable(),
    maxPairsPerDay: z.number().int().positive().nullable(),
    phone: z.string().nullable(),
    mainWorkplace: z.string().nullable(),
    availabilityNote: z.string().nullable(),
    hiredAt: z.string().nullable(),
    // Обычное поле формы, не отдельное действие (§2.3: «Петров уволен с 15.10» — конкретная
    // дата, не «сегодня»): указывается и снимается прямо в карточке, как hiredAt.
    firedAt: z.string().nullable(),
    note: z.string().nullable(),
  })
  .superRefine(requireRowVersionOnUpdate)

export const teacherDeleteInput = z.object({ id: z.number().int().positive() })

// Квалификации преподавателя — историчная связь «преподаватель ↔ дисциплина» (§2.3).
export const teacherQualificationsListInput = z.object({ teacherId: z.number().int().positive() })

export const teacherQualificationCreateInput = z.object({
  teacherId: z.number().int().positive(),
  disciplineId: z.number().int().positive('Выберите дисциплину'),
  validFrom: z.string().min(1, 'Укажите дату начала'),
})

export const teacherQualificationCloseInput = z.object({
  id: z.number().int().positive(),
  rowVersion: z.number().int().positive(),
  validTo: z.string().min(1, 'Укажите дату закрытия'),
})

// Недоступность преподавателя (§2.3): «Иванова не ведёт по средам».
const absenceKind = z.enum(['hard', 'soft'])
const absenceScope = z.enum(['weekday', 'date_range'])

export const teacherAbsencesListInput = z.object({ teacherId: z.number().int().positive() })

export const teacherAbsenceCreateInput = z
  .object({
    teacherId: z.number().int().positive(),
    kind: absenceKind,
    scope: absenceScope,
    // Пн–Сб, 6 дней (§2, §4.4: template_entry.day_of_week тоже 1..6) — учебной недели без воскресенья.
    dayOfWeek: z.number().int().min(1, 'От 1 до 6').max(6, 'От 1 до 6').nullable(),
    dateFrom: z.string().nullable(),
    dateTo: z.string().nullable(),
    pairFrom: z.number().int().min(1, 'От 1 до 6').max(6, 'От 1 до 6'),
    pairTo: z.number().int().min(1, 'От 1 до 6').max(6, 'От 1 до 6'),
    weight: z.number().int().min(0),
    reason: z.string().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.scope === 'weekday' && v.dayOfWeek == null) {
      ctx.addIssue({ code: 'custom', message: 'Укажите день недели', path: ['dayOfWeek'] })
    }
    if (v.scope === 'date_range' && (v.dateFrom == null || v.dateTo == null)) {
      ctx.addIssue({ code: 'custom', message: 'Укажите даты периода', path: ['dateFrom'] })
    }
    if (v.dateFrom != null && v.dateTo != null && v.dateFrom > v.dateTo) {
      ctx.addIssue({ code: 'custom', message: 'Дата окончания раньше даты начала', path: ['dateTo'] })
    }
    if (v.pairFrom > v.pairTo) {
      ctx.addIssue({ code: 'custom', message: 'Последняя пара раньше первой', path: ['pairTo'] })
    }
  })

export const teacherAbsenceDeleteInput = z.object({ id: z.number().int().positive() })

// Группы (§2.4): период действия — тот же validFrom/validTo, что и у кабинета,
// «объединение» — отдельная операция ниже, а не поле формы.
export const groupsListInput = z.object({ includeClosed: z.boolean().optional() })

export const groupSaveInput = withOptimisticId
  .extend({
    name: z.string().min(1, 'Укажите название группы'),
    specialityId: z.number().int().positive('Выберите специальность'),
    admissionYear: z.number().int().min(2000, 'Некорректный год').max(2100, 'Некорректный год'),
    course: z.number().int().min(1, 'От 1 до 4').max(4, 'От 1 до 4'),
    studentsCount: z.number().int().positive('Укажите число студентов'),
    maxPairsPerDay: z.number().int().min(1, 'От 1 до 6').max(6, 'От 1 до 6'),
    maxHoursPerWeek: z.number().int().positive('Укажите лимит часов в неделю'),
    funding: z.enum(['budget', 'contract']),
    validFrom: z.string().min(1, 'Укажите дату начала действия'),
  })
  .superRefine(requireRowVersionOnUpdate)

export const groupCloseInput = z.object({
  id: z.number().int().positive(),
  rowVersion: z.number().int().positive(),
  // null — вновь открыть ранее закрытую группу (симметрично кабинету).
  validTo: z.string().min(1).nullable(),
})

export const groupDeleteInput = z.object({ id: z.number().int().positive() })

// Объединение групп (§2.4): предпросмотр — сколько активных строк нагрузки/потоков
// будет перенесено с поглощённой группы на целевую, затем применение как bulk_edit-операция.
export const groupMergePreviewInput = z.object({
  sourceGroupId: z.number().int().positive(),
  targetGroupId: z.number().int().positive(),
  mergeDate: z.string().min(1, 'Укажите дату объединения'),
})

export const groupMergeInput = groupMergePreviewInput

// Учебные годы и семестры (§2.8, минимальный срез вперёд задачи — понадобился как
// зависимость §2.5: схема деления привязана к семестру, без него форму не заполнить).
// Полноценный календарь (calendar_day, праздники, переносы) — сама задача 2.8, отдельно.
export const academicYearsListInput = z.object({})

export const academicYearSaveInput = withOptimisticId
  .extend({
    name: z.string().min(1, 'Укажите название учебного года'),
    startsOn: z.string().min(1, 'Укажите дату начала'),
    endsOn: z.string().min(1, 'Укажите дату окончания'),
  })
  .superRefine(requireRowVersionOnUpdate)
  .superRefine(requireOrderedRange)

export const academicYearDeleteInput = z.object({ id: z.number().int().positive() })

export const semestersListInput = z.object({ academicYearId: z.number().int().positive().optional() })

export const semesterSaveInput = withOptimisticId
  .extend({
    academicYearId: z.number().int().positive('Выберите учебный год'),
    no: z.union([z.literal(1), z.literal(2)]),
    startsOn: z.string().min(1, 'Укажите дату начала'),
    endsOn: z.string().min(1, 'Укажите дату окончания'),
    weeksCount: z.number().int().positive('Укажите число недель'),
    status: z.enum(['planning', 'active', 'closed']),
  })
  .superRefine(requireRowVersionOnUpdate)
  .superRefine(requireOrderedRange)

export const semesterDeleteInput = z.object({ id: z.number().int().positive() })

// Схемы деления на подгруппы (§2.5): «разделить на 2»/«разделить на 3» с автоматическим
// расчётом границ (§4.6) — число и состав подгрупп фиксируются при создании схемы,
// дальше можно только вручную поправить границы (posFrom/posTo), не добавляя/убирая подгруппы.
export const divisionSchemesListInput = z.object({ groupId: z.number().int().positive() })

export const divisionSchemeCreateInput = z.object({
  groupId: z.number().int().positive(),
  semesterId: z.number().int().positive('Выберите семестр'),
  name: z.string().min(1, 'Укажите название схемы'),
  partsCount: z.union([z.literal(2), z.literal(3)]),
  isDefault: z.boolean(),
})

const subgroupBoundInput = z.object({
  subgroupId: z.number().int().positive(),
  rowVersion: z.number().int().positive(),
  posFrom: z.number().int().positive(),
  posTo: z.number().int().positive(),
})

export const divisionSchemeUpdateBoundsInput = z.object({
  schemeId: z.number().int().positive(),
  bounds: z.array(subgroupBoundInput).min(1),
})

export const divisionSchemeCloseInput = z.object({
  id: z.number().int().positive(),
  rowVersion: z.number().int().positive(),
  validTo: z.string().min(1).nullable(),
})

export const divisionSchemeSetDefaultInput = z.object({ id: z.number().int().positive() })

export const divisionSchemeDeleteInput = z.object({ id: z.number().int().positive() })

// Календарь (§2.8): генерация calendar_day на период семестра, праздники/каникулы/переносы —
// всё вручную. Правка одного дня пишется в change_log как обычная правка (см. репозиторий) —
// формальный конверт «операции» (§1.5) здесь избыточен, он для массовых/отменяемых действий.
export const calendarDaysListInput = z.object({ from: z.string().min(1), to: z.string().min(1) })

export const calendarDaysGenerateInput = z.object({ semesterId: z.number().int().positive() })

const calendarDayKind = z.enum(['study', 'weekend', 'holiday', 'vacation', 'moved_workday'])

export const calendarDaySetKindInput = z.object({
  date: z.string().min(1),
  rowVersion: z.number().int().positive(),
  kind: calendarDayKind,
  movedFromDate: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
})

// Периоды графика учебного процесса (§2.8): каникулы, практика, сессия и т.п. — обычный CRUD,
// т.к. calendar_period.id — числовой (в отличие от calendar_day.date).
const calendarPeriodKind = z.enum(['theory', 'practice', 'prequal_practice', 'vacation', 'session', 'iga', 'quarantine'])

export const calendarPeriodsListInput = z.object({})

export const calendarPeriodSaveInput = withOptimisticId
  .extend({
    kind: calendarPeriodKind,
    course: z.number().int().positive().nullable(),
    specialityId: z.number().int().positive().nullable(),
    groupId: z.number().int().positive().nullable(),
    startsOn: z.string().min(1, 'Укажите дату начала'),
    endsOn: z.string().min(1, 'Укажите дату окончания'),
    note: z.string().nullable(),
  })
  .superRefine(requireRowVersionOnUpdate)
  .superRefine(requireOrderedRange)

export const calendarPeriodDeleteInput = z.object({ id: z.number().int().positive() })

// Сетка звонков (§2.9): одна на весь колледж, до 6 пар, редактируется целиком на странице настроек.
const pairGridRowInput = z.object({
  pairNo: z.number().int().min(1).max(6),
  rowVersion: z.number().int().positive(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  academicHours: z.number().int().positive(),
  enabled: z.boolean(),
})

export const pairGridListInput = z.object({})

export const pairGridSaveInput = z.object({ rows: z.array(pairGridRowInput).min(1) }).refine(
  (v) => v.rows.every((r) => r.startsAt < r.endsAt),
  { message: 'Время начала пары должно быть раньше времени окончания', path: ['rows'] },
)

// Веса мягких критериев солвера (§5.5, этап 6) — редактируются целиком на странице настроек.
const constraintWeightRowInput = z.object({
  id: z.number().int().positive(),
  rowVersion: z.number().int().positive(),
  weight: z.number().int().min(0).max(100),
  enabled: z.boolean(),
})

export const constraintWeightsListInput = z.object({})
export const constraintWeightsSaveInput = z.object({ rows: z.array(constraintWeightRowInput).min(1) })

// Учебный план (§3.1–3.4).
export const curriculaListInput = z.object({ specialityId: z.number().int().positive().optional(), includeArchived: z.boolean().optional() })

export const curriculumSaveInput = withOptimisticId
  .extend({
    specialityId: z.number().int().positive('Выберите специальность'),
    admissionYear: z.number().int().min(2000, 'Некорректный год').max(2100, 'Некорректный год'),
    name: z.string().min(1, 'Укажите название плана'),
  })
  .superRefine(requireRowVersionOnUpdate)

export const curriculumApproveInput = z.object({ id: z.number().int().positive(), rowVersion: z.number().int().positive() })

export const curriculumArchiveInput = z.object({
  id: z.number().int().positive(),
  rowVersion: z.number().int().positive(),
  archived: z.boolean(),
})

export const curriculumCopyInput = z.object({
  fromCurriculumId: z.number().int().positive(),
  specialityId: z.number().int().positive('Выберите специальность'),
  admissionYear: z.number().int().min(2000, 'Некорректный год').max(2100, 'Некорректный год'),
  name: z.string().min(1, 'Укажите название плана'),
})

// Строки плана (§3.1): четыре вида часов + СРС (§1.1 п.33), инвариант
// «кредиты×30=всего часов» проверяется в UI как предупреждение, не здесь — завуч
// может сознательно отступить, блокировать сохранение нельзя.
const curriculumRowFieldsInput = {
  disciplineId: z.number().int().positive('Выберите дисциплину'),
  course: z.number().int().min(1, 'От 1 до 4').max(4, 'От 1 до 4'),
  semesterNo: z.number().int().min(1, 'От 1 до 8').max(8, 'От 1 до 8'),
  credits: z.number().int().positive('Укажите кредиты'),
  hoursTotal: z.number().int().nonnegative(),
  hoursClassroom: z.number().int().nonnegative(),
  hoursTheory: z.number().int().nonnegative(),
  hoursPractice: z.number().int().nonnegative(),
  hoursSeminar: z.number().int().nonnegative(),
  hoursLab: z.number().int().nonnegative(),
  hoursSrs: z.number().int().nonnegative(),
  controlSemester: z.number().int().positive().nullable(),
}

export const curriculumRowsListInput = z.object({ curriculumId: z.number().int().positive() })

export const curriculumRowCreateInput = z.object({
  curriculumId: z.number().int().positive(),
  validFrom: z.string().min(1, 'Укажите дату начала действия'),
  ...curriculumRowFieldsInput,
})

export const curriculumRowEditPreviewInput = z.object({
  id: z.number().int().positive(),
  effectiveFrom: z.string().min(1, 'Укажите дату правки'),
})

export const curriculumRowEditInput = z.object({
  id: z.number().int().positive(),
  rowVersion: z.number().int().positive(),
  effectiveFrom: z.string().min(1, 'Укажите дату правки'),
  ...curriculumRowFieldsInput,
})

export const curriculumRowDeleteInput = z.object({ id: z.number().int().positive() })

// Быстрый ручной ввод (§3.10): вставка диапазона из буфера — та же нестрогая форма
// строки, что и мастер импорта (import:apply), только фиксированный целевой план.
export const curriculumRowsBulkCreateInput = z.object({
  curriculumId: z.number().int().positive(),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).min(1),
  validFrom: z.string().min(1, 'Укажите дату начала действия'),
})

// Недельная раскладка (§3.4).
export const curriculumWeeksListInput = z.object({ curriculumRowId: z.number().int().positive() })

export const curriculumWeeksGenerateInput = z.object({
  curriculumRowId: z.number().int().positive(),
  weekCount: z.number().int().positive('Укажите число недель'),
})

const curriculumWeekSaveRowInput = z.object({
  id: z.number().int().positive(),
  rowVersion: z.number().int().positive(),
  hours: z.number().int().nonnegative(),
})

export const curriculumWeeksSaveInput = z.object({
  curriculumRowId: z.number().int().positive(),
  weeks: z.array(curriculumWeekSaveRowInput).min(1),
})

// Нагрузка (§3.5, §3.6, §3.6a): «ровно одно из group/stream» проверяется в репозитории
// (нужен доступ к БД для содержательного сообщения), здесь — только форма полей.
export const teachingLoadListInput = z.object({ semesterId: z.number().int().positive() })

export const teachingLoadSaveInput = withOptimisticId
  .extend({
    semesterId: z.number().int().positive(),
    curriculumRowId: z.number().int().positive('Выберите строку плана'),
    teacherId: z.number().int().positive('Выберите преподавателя'),
    groupId: z.number().int().positive().nullable(),
    streamId: z.number().int().positive().nullable(),
    divisionSchemeId: z.number().int().positive().nullable(),
    subgroupId: z.number().int().positive().nullable(),
    lessonKind: z.enum(['theory', 'practice', 'seminar', 'lab']),
    hoursPlanned: z.number().int().positive('Укажите часы'),
    requiresParallel: z.boolean(),
    roomTypeRequired: roomType.nullable(),
    clinicalModeOverride: z.enum(['full_day', 'block', 'free']).nullable(),
    note: z.string().nullable(),
    validFrom: z.string().min(1, 'Укажите дату начала действия'),
  })
  .superRefine(requireRowVersionOnUpdate)

export const teachingLoadDeleteInput = z.object({ id: z.number().int().positive() })

// Потоки (§3.5a).
export const streamsListForSemesterInput = z.object({ semesterId: z.number().int().positive() })

export const streamCreateInput = z.object({
  semesterId: z.number().int().positive(),
  name: z.string().min(1, 'Укажите название потока'),
  groupIds: z.array(z.number().int().positive()).min(2, 'Выберите минимум 2 группы'),
  validFrom: z.string().min(1, 'Укажите дату начала действия'),
})

export const streamDisbandInput = z.object({ id: z.number().int().positive() })

// Прочие часы (§3.9a): вне сетки, солвер их не получает.
export const otherLoadListInput = z.object({ semesterId: z.number().int().positive() })

export const otherLoadSaveInput = withOptimisticId
  .extend({
    semesterId: z.number().int().positive(),
    teacherId: z.number().int().positive('Выберите преподавателя'),
    kind: z.enum(['test', 'method', 'iga', 'other']),
    hours: z.number().int().positive('Укажите часы'),
    groupId: z.number().int().positive().nullable(),
    note: z.string().nullable(),
  })
  .superRefine(requireRowVersionOnUpdate)

export const otherLoadDeleteInput = z.object({ id: z.number().int().positive() })

// Баланс нагрузки (§3.7).
export const loadBalanceByGroupInput = z.object({ semesterId: z.number().int().positive() })
export const loadBalanceByTeacherInput = z.object({ semesterId: z.number().int().positive() })

// Расписание (§4.1–4.11): шаблон недели с версиями и записи 6×6.
const weekParity = z.enum(['all', 'odd', 'even'])

export const scheduleTemplatesListInput = z.object({ semesterId: z.number().int().positive() })

export const scheduleTemplateCreateInput = z.object({
  semesterId: z.number().int().positive(),
  effectiveFrom: z.string().min(1, 'Укажите дату вступления в силу'),
  note: z.string().nullable(),
  copyFromTemplateId: z.number().int().positive().nullable().optional(),
})

export const scheduleTemplateActivateInput = z.object({ id: z.number().int().positive(), rowVersion: z.number().int().positive() })
export const scheduleTemplateArchiveInput = z.object({ id: z.number().int().positive(), rowVersion: z.number().int().positive() })
export const scheduleTemplateEntriesInput = z.object({ templateId: z.number().int().positive() })
export const scheduleTemplateUnassignedLoadInput = z.object({ templateId: z.number().int().positive() })

export const placeEntryInput = z.object({
  templateId: z.number().int().positive(),
  teachingLoadId: z.number().int().positive(),
  dayOfWeek: z.number().int().min(1).max(6),
  pairNo: z.number().int().min(1).max(6),
  weekParity,
  roomId: z.number().int().positive().nullable(),
})

export const moveEntryInput = z.object({
  id: z.number().int().positive(),
  rowVersion: z.number().int().positive(),
  dayOfWeek: z.number().int().min(1).max(6),
  pairNo: z.number().int().min(1).max(6),
  weekParity,
  roomId: z.number().int().positive().nullable(),
})

export const setEntryLockedInput = z.object({
  id: z.number().int().positive(),
  rowVersion: z.number().int().positive(),
  isLocked: z.boolean(),
})

export const removeEntryInput = z.object({ id: z.number().int().positive(), rowVersion: z.number().int().positive() })

function requireOrderedDateFromTo<T extends { dateFrom: string; dateTo: string }>(v: T, ctx: z.RefinementCtx) {
  if (v.dateFrom > v.dateTo) {
    ctx.addIssue({ code: 'custom', message: 'Дата окончания раньше даты начала', path: ['dateTo'] })
  }
}

export const rolloutRangeInput = z
  .object({
    templateId: z.number().int().positive(),
    dateFrom: z.string().min(1, 'Укажите дату начала'),
    dateTo: z.string().min(1, 'Укажите дату окончания'),
  })
  .superRefine(requireOrderedDateFromTo)

export const scheduleConflictsInput = z
  .object({ dateFrom: z.string().min(1, 'Укажите дату начала'), dateTo: z.string().min(1, 'Укажите дату окончания') })
  .superRefine(requireOrderedDateFromTo)

// Мастер импорта (§3.8): значения ячеек — string|number|null, разбор самой сетки
// не зависит от целевой сущности (engine.ts), поэтому схема входа здесь намеренно нестрогая.
const targetEntity = z.enum(['curriculum', 'teaching_load', 'teacher', 'calendar_period'])
const cellValue = z.union([z.string(), z.number(), z.null()])

export const importPickFileInput = z.object({})

export const importListSheetsInput = z.object({ filePath: z.string().min(1) })

export const importReadGridInput = z.object({ filePath: z.string().min(1), sheetName: z.string().min(1) })

export const importProfilesListInput = z.object({ targetEntity: targetEntity.optional() })

export const importProfileSaveInput = withOptimisticId
  .extend({
    name: z.string().min(1, 'Укажите название профиля'),
    targetEntity,
    mappingJson: z.string().min(1),
  })
  .superRefine(requireRowVersionOnUpdate)

export const importProfileDeleteInput = z.object({ id: z.number().int().positive() })

export const importApplyInput = z.object({
  targetEntity,
  rows: z.array(z.record(z.string(), cellValue)),
  curriculumId: z.number().int().positive().optional(),
  semesterId: z.number().int().positive().optional(),
  validFrom: z.string().min(1, 'Укажите дату начала действия'),
})

export const exportExcelInput = z.object({
  templateId: z.number().int().positive(),
  kind: z.enum(['group', 'teacher', 'summary']),
  targetId: z.number().int().positive().optional(),
})

export const exportPdfInput = z.object({
  templateId: z.number().int().positive(),
  groupId: z.number().int().positive(),
})
