import type { Cell, Grid, TargetEntity } from '../import/engine'

export interface OperationSummary {
  id: number
  kind: 'generate' | 'rollout' | 'import' | 'bulk_edit' | 'restore'
  status: 'preview' | 'applied' | 'undone'
  paramsJson: string | null
  summaryJson: string | null
  startedAt: string
  finishedAt: string | null
  createdBy: string
}

export interface ChangeLogEntry {
  id: number
  entity: string
  entityId: number
  action: 'create' | 'update' | 'close' | 'delete'
  beforeJson: string | null
  afterJson: string | null
  at: string
  user: string
  reason: string | null
}

export interface BackupInfo {
  id: number
  fileName: string
  createdAt: string
  reason: 'schedule' | 'pre_migration' | 'manual' | 'pre_restore'
  sizeBytes: number
  schemaVersion: string | null
}

// Справочники (§2.2) — руками, а не импортом из main/db/schema: shared/ не должен
// зависеть от main/, иначе ломается изоляция слоёв (§3.1).
export interface Speciality {
  id: number
  code: string
  name: string
  qualification: string | null
  semestersTotal: number
  archivedAt: string | null
  rowVersion: number
}

export interface Cmc {
  id: number
  name: string
  headTeacherId: number | null
  rowVersion: number
}

export interface Building {
  id: number
  name: string
  address: string | null
  isClinical: boolean
  clinicalMode: 'full_day' | 'block' | 'free' | null
  rowVersion: number
}

export interface Room {
  id: number
  buildingId: number
  number: string
  name: string | null
  capacity: number | null
  roomType: 'lecture' | 'practice' | 'seminar' | 'lab' | 'phantom' | 'computer' | 'gym'
  pinnedTeacherId: number | null
  validFrom: string
  validTo: string | null
  rowVersion: number
}

export interface Discipline {
  id: number
  name: string
  indexCode: string | null
  block: 1 | 2 | 3
  cycle: 'spo1' | 'spo2' | 'spo3' | 'spo4' | 'spo5'
  part: 'base' | 'elective'
  difficulty: number
  defaultRoomType: Room['roomType'] | null
  requiresClinical: boolean
  archivedAt: string | null
  rowVersion: number
}

export interface TeacherCategory {
  id: number
  code: 'staff' | 'external' | 'hourly'
  titleRu: string
  normHoursYear: number | null
  rowVersion: number
}

export interface Teacher {
  id: number
  lastName: string
  firstName: string
  middleName: string | null
  cmcId: number | null
  categoryId: number
  rate: number
  maxHoursYear: number | null
  maxPairsPerDay: number | null
  phone: string | null
  mainWorkplace: string | null
  availabilityNote: string | null
  hiredAt: string | null
  firedAt: string | null
  note: string | null
  rowVersion: number
}

export interface TeacherQualification {
  id: number
  teacherId: number
  disciplineId: number
  validFrom: string
  validTo: string | null
  rowVersion: number
}

export interface TeacherAbsence {
  id: number
  teacherId: number
  kind: 'hard' | 'soft'
  scope: 'weekday' | 'date_range'
  dayOfWeek: number | null
  dateFrom: string | null
  dateTo: string | null
  pairFrom: number
  pairTo: number
  weight: number
  reason: string | null
  rowVersion: number
}

export interface StudyGroup {
  id: number
  name: string
  specialityId: number
  admissionYear: number
  course: number
  studentsCount: number
  maxPairsPerDay: number
  maxHoursPerWeek: number
  funding: 'budget' | 'contract'
  validFrom: string
  validTo: string | null
  mergedIntoId: number | null
  rowVersion: number
}

export interface GroupMergePreview {
  sourceGroupName: string
  targetGroupName: string
  affectedTeachingLoad: number
  affectedStreamMembers: number
}

export interface AcademicYear {
  id: number
  name: string
  startsOn: string
  endsOn: string
  rowVersion: number
}

export interface Semester {
  id: number
  academicYearId: number
  no: 1 | 2
  startsOn: string
  endsOn: string
  weeksCount: number
  status: 'planning' | 'active' | 'closed'
  rowVersion: number
}

export interface DivisionScheme {
  id: number
  groupId: number
  semesterId: number
  name: string
  partsCount: number
  isDefault: boolean
  validFrom: string
  validTo: string | null
  rowVersion: number
}

export interface Subgroup {
  id: number
  groupId: number
  schemeId: number
  no: number
  posFrom: number
  posTo: number
  validFrom: string
  validTo: string | null
  rowVersion: number
}

export interface DivisionSchemeWithSubgroups extends DivisionScheme {
  subgroups: Subgroup[]
}

export interface CalendarDay {
  date: string
  semesterId: number | null
  kind: 'study' | 'weekend' | 'holiday' | 'vacation' | 'moved_workday'
  movedFromDate: string | null
  note: string | null
  rowVersion: number
}

export interface CalendarPeriod {
  id: number
  kind: 'theory' | 'practice' | 'prequal_practice' | 'vacation' | 'session' | 'iga' | 'quarantine'
  course: number | null
  specialityId: number | null
  groupId: number | null
  startsOn: string
  endsOn: string
  note: string | null
  rowVersion: number
}

export interface PairGridRow {
  pairNo: number
  startsAt: string
  endsAt: string
  academicHours: number
  enabled: boolean
  rowVersion: number
}

// Учебный план (§3.1–3.4). Схема БД (curriculum/curriculum_row/curriculum_week)
// смоделирована ещё в этапе 1 — здесь только домен-типы IPC-контракта.
export interface Curriculum {
  id: number
  specialityId: number
  admissionYear: number
  name: string
  status: 'draft' | 'approved' | 'archived'
  approvedAt: string | null
  approvedBy: string | null
  rowVersion: number
}

export interface CurriculumRow {
  id: number
  curriculumId: number
  disciplineId: number
  course: number
  semesterNo: number
  credits: number
  hoursTotal: number
  hoursClassroom: number
  hoursTheory: number
  hoursPractice: number
  hoursSeminar: number
  hoursLab: number
  hoursSrs: number
  controlSemester: number | null
  validFrom: string
  validTo: string | null
  supersedesId: number | null
  rowVersion: number
}

export interface CurriculumWeek {
  id: number
  curriculumRowId: number
  weekNo: number
  hours: number
  rowVersion: number
}

export interface CurriculumRowEditPreview {
  affectedLessons: number
}

export interface CurriculumRowsBulkCreateResult {
  operationId: number
  created: number
  skipped: { row: Record<string, Cell>; reason: string }[]
}

// Нагрузка, потоки, прочие часы (§3.5–3.7a). Схема (stream/stream_member/teaching_load,
// other_load) смоделирована в этапах 1–2 — здесь только домен-типы IPC-контракта.
export interface TeachingLoad {
  id: number
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
  pairedLoadId: number | null
  roomTypeRequired: Room['roomType'] | null
  roomIdFixed: number | null
  buildingIdRequired: number | null
  clinicalModeOverride: 'full_day' | 'block' | 'free' | null
  validFrom: string
  validTo: string | null
  note: string | null
  rowVersion: number
}

export interface TeachingLoadSaveResult {
  row: TeachingLoad
  teacherHoursOverYear: number | null
}

export interface Stream {
  id: number
  semesterId: number
  name: string
  validFrom: string
  validTo: string | null
  rowVersion: number
}

export interface StreamMember {
  id: number
  streamId: number
  groupId: number
  validFrom: string
  validTo: string | null
  rowVersion: number
}

export interface StreamWithMembers extends Stream {
  members: StreamMember[]
}

export interface OtherLoad {
  id: number
  semesterId: number
  teacherId: number
  kind: 'test' | 'method' | 'iga' | 'other'
  hours: number
  groupId: number | null
  note: string | null
  rowVersion: number
}

export interface GroupBalanceRow {
  groupId: number
  groupName: string
  plannedHours: number
  assignedHours: number
  remainingHours: number
  /** Недельный лимит группы (§1.1 п.20) и он же в пересчёте на семестр — чтобы приближение к лимиту было видно до генерации (§3.7a). */
  maxHoursPerWeek: number
  limitHours: number
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

// Расписание (§4, §5.8): шаблон недели с версиями, записи 6×6, материализация в даты.
// Схема (schedule_template/template_entry/lesson/lesson_group) смоделирована в этапе 1 —
// здесь только домен-типы IPC-контракта этапа 4.
export interface ScheduleTemplate {
  id: number
  semesterId: number
  versionNo: number
  effectiveFrom: string
  effectiveTo: string | null
  status: 'draft' | 'active' | 'archived'
  basedOnId: number | null
  note: string | null
  rowVersion: number
}

export interface TemplateEntryAttendee {
  groupId: number
  groupName: string
  subgroupId: number | null
  subgroupNo: number | null
  posFrom: number
  posTo: number
}

export interface TemplateEntryView {
  id: number
  templateId: number
  dayOfWeek: number
  pairNo: number
  weekParity: 'all' | 'odd' | 'even'
  isLocked: boolean
  source: 'solver' | 'manual'
  roomId: number | null
  roomLabel: string | null
  teacherId: number
  teacherName: string
  teachingLoadId: number
  disciplineId: number
  disciplineName: string
  lessonKind: 'theory' | 'practice' | 'seminar' | 'lab'
  academicHours: number
  targetLabel: string
  attendees: TemplateEntryAttendee[]
  rowVersion: number
}

export interface UnassignedLoadRow {
  teachingLoadId: number
  teacherId: number
  teacherName: string
  disciplineName: string
  targetLabel: string
  lessonKind: 'theory' | 'practice' | 'seminar' | 'lab'
  hoursPlanned: number
  hoursAssigned: number
  hoursRemaining: number
  attendees: TemplateEntryAttendee[]
}

export interface RolloutChangeItem {
  date: string
  entryId: number
  action: 'create' | 'update' | 'cancel'
  description: string
}

export interface RolloutPreview {
  toCreate: number
  toUpdate: number
  toCancel: number
  items: RolloutChangeItem[]
}

export interface RolloutApplyResult {
  operationId: number
  created: number
  updated: number
  cancelled: number
}

export interface ScheduleConflictView {
  date: string
  dayOfWeek: number
  pairNo: number
  description: string
  lessonAId: number
  lessonBId: number
  semesterId: number | null
  templateId: number | null
  groupId: number | null
}

// Универсальный мастер импорта (§3.8): main читает файл (ExcelJS) и хранит профили,
// разбор сетки — общие чистые функции shared/import/engine.ts, переиспользуемые и в renderer
// для живого предпросмотра без обращения к main на каждое изменение настройки.
export interface SheetInfo {
  name: string
  rowCount: number
  columnCount: number
}

export interface ImportProfile {
  id: number
  name: string
  targetEntity: TargetEntity
  mappingJson: string
  rowVersion: number
}

export interface ImportApplyResult {
  operationId: number
  created: number
  skipped: { row: Record<string, Cell>; reason: string }[]
}

export interface IpcContract {
  'settings:get': { in: { key: string }; out: { value: string | null } }
  'settings:set': { in: { key: string; value: string }; out: { ok: true } }

  // Заготовка utilityProcess (задача 0.7): проверка форк/прогресс/отмена.
  // Будет заменена реальным 'generation:*' в этапе 5 (§3.5).
  'demo:compute:start': { in: { seed: number }; out: { jobId: string } }
  'demo:compute:cancel': { in: { jobId: string }; out: { ok: true } }

  // Операции и аудит (§1.5, §2.10, §3.2) — ядро данных этапа 1, UI появится в этапе 2.
  'operations:list': { in: { kind?: OperationSummary['kind'] }; out: OperationSummary[] }
  'operations:undo': { in: { operationId: number }; out: { ok: true } }
  'audit:entity': { in: { entity: string; id: number }; out: ChangeLogEntry[] }

  // Бэкапы и восстановление (§1.6, §1.7, §1.7a).
  'backup:list': { in: Record<string, never>; out: BackupInfo[] }
  'backup:create': { in: { reason: 'manual' }; out: BackupInfo }
  // Успешный вызов закрывает БД и перезапускает приложение — обычный ответ не возвращается.
  'backup:restore': { in: { fileName: string }; out: { ok: true } }
  'backup:externalCopy': { in: Record<string, never>; out: { copiedTo: string; at: string } | { cancelled: true } }
  'backup:externalStatus': { in: Record<string, never>; out: { lastExternalCopyAt: string | null; isStale: boolean } }

  // Справочники (§2.2): создание/правка — единый канал 'save' (id есть → update, нет → create).
  'specialities:list': { in: { includeArchived?: boolean }; out: Speciality[] }
  'specialities:save': { in: SpecialitySaveInput; out: Speciality }
  'specialities:archive': { in: { id: number; rowVersion: number; archived: boolean }; out: { ok: true } }

  'cmc:list': { in: Record<string, never>; out: Cmc[] }
  'cmc:save': { in: CmcSaveInput; out: Cmc }
  'cmc:delete': { in: { id: number }; out: { ok: true } }

  'buildings:list': { in: Record<string, never>; out: Building[] }
  'buildings:save': { in: BuildingSaveInput; out: Building }
  'buildings:delete': { in: { id: number }; out: { ok: true } }

  'rooms:list': { in: { buildingId?: number; includeClosed?: boolean }; out: Room[] }
  'rooms:save': { in: RoomSaveInput; out: Room }
  'rooms:close': { in: { id: number; rowVersion: number; validTo: string | null }; out: { ok: true } }
  'rooms:delete': { in: { id: number }; out: { ok: true } }

  // Дисциплины (§2.7).
  'disciplines:list': { in: { includeArchived?: boolean }; out: Discipline[] }
  'disciplines:save': { in: DisciplineSaveInput; out: Discipline }
  'disciplines:archive': { in: { id: number; rowVersion: number; archived: boolean }; out: { ok: true } }

  // Категории преподавателей — фиксированный набор из трёх строк (§4.3), заводится
  // один раз при первом запуске (см. ensureTeacherCategories); CRUD не нужен.
  'teacherCategories:list': { in: Record<string, never>; out: TeacherCategory[] }

  // Преподаватели (§2.3).
  'teachers:list': { in: { includeFired?: boolean }; out: Teacher[] }
  'teachers:save': { in: TeacherSaveInput; out: Teacher }
  'teachers:delete': { in: { id: number }; out: { ok: true } }

  'teacherQualifications:list': { in: { teacherId: number }; out: TeacherQualification[] }
  'teacherQualifications:create': { in: TeacherQualificationCreateInput; out: TeacherQualification }
  // affectedLoadCount — сколько строк нагрузки уже назначено на эту пару преподаватель+дисциплина
  // (§2.3: «предупреждается о затронутой нагрузке»); нагрузка появится в этапе 3, сейчас всегда 0.
  'teacherQualifications:close': {
    in: { id: number; rowVersion: number; validTo: string }
    out: { ok: true; affectedLoadCount: number }
  }

  'teacherAbsences:list': { in: { teacherId: number }; out: TeacherAbsence[] }
  'teacherAbsences:create': { in: TeacherAbsenceCreateInput; out: TeacherAbsence }
  'teacherAbsences:delete': { in: { id: number }; out: { ok: true } }

  // Группы (§2.4).
  'groups:list': { in: { includeClosed?: boolean }; out: StudyGroup[] }
  'groups:save': { in: GroupSaveInput; out: StudyGroup }
  'groups:close': { in: { id: number; rowVersion: number; validTo: string | null }; out: { ok: true } }
  'groups:delete': { in: { id: number }; out: { ok: true } }
  'groups:mergePreview': { in: { sourceGroupId: number; targetGroupId: number; mergeDate: string }; out: GroupMergePreview }
  'groups:merge': { in: { sourceGroupId: number; targetGroupId: number; mergeDate: string }; out: { operationId: number } }

  // Учебные годы и семестры — минимальный срез §2.8, см. комментарий в schemas.ts.
  'academicYears:list': { in: Record<string, never>; out: AcademicYear[] }
  'academicYears:save': { in: AcademicYearSaveInput; out: AcademicYear }
  'academicYears:delete': { in: { id: number }; out: { ok: true } }

  'semesters:list': { in: { academicYearId?: number }; out: Semester[] }
  'semesters:save': { in: SemesterSaveInput; out: Semester }
  'semesters:delete': { in: { id: number }; out: { ok: true } }

  // Схемы деления на подгруппы (§2.5).
  'divisionSchemes:listForGroup': { in: { groupId: number }; out: DivisionSchemeWithSubgroups[] }
  'divisionSchemes:create': { in: DivisionSchemeCreateInput; out: DivisionSchemeWithSubgroups }
  'divisionSchemes:updateBounds': {
    in: { schemeId: number; bounds: { subgroupId: number; rowVersion: number; posFrom: number; posTo: number }[] }
    out: DivisionSchemeWithSubgroups
  }
  'divisionSchemes:close': { in: { id: number; rowVersion: number; validTo: string | null }; out: { ok: true } }
  'divisionSchemes:setDefault': { in: { id: number }; out: { ok: true } }
  'divisionSchemes:delete': { in: { id: number }; out: { ok: true } }

  // Календарь (§2.8): дни материализуются на период семестра, дальше правятся вручную.
  'calendarDays:list': { in: { from: string; to: string }; out: CalendarDay[] }
  'calendarDays:generate': { in: { semesterId: number }; out: { generated: number } }
  'calendarDays:setKind': {
    in: { date: string; rowVersion: number; kind: CalendarDay['kind']; movedFromDate?: string | null; note?: string | null }
    out: { day: CalendarDay; cancelledLessons: number }
  }

  'calendarPeriods:list': { in: Record<string, never>; out: CalendarPeriod[] }
  'calendarPeriods:save': { in: CalendarPeriodSaveInput; out: CalendarPeriod }
  'calendarPeriods:delete': { in: { id: number }; out: { ok: true } }

  // Сетка звонков (§2.9): одна на весь колледж, сохраняется целиком.
  'pairGrid:list': { in: Record<string, never>; out: PairGridRow[] }
  'pairGrid:save': {
    in: { rows: { pairNo: number; rowVersion: number; startsAt: string; endsAt: string; academicHours: number; enabled: boolean }[] }
    out: PairGridRow[]
  }

  // Учебный план (§3.1–3.3): создание/правка плана — единый канал 'save', как справочники.
  'curricula:list': { in: { specialityId?: number; includeArchived?: boolean }; out: Curriculum[] }
  'curricula:save': { in: CurriculumSaveInput; out: Curriculum }
  'curricula:approve': { in: { id: number; rowVersion: number }; out: { ok: true } }
  'curricula:archive': { in: { id: number; rowVersion: number; archived: boolean }; out: { ok: true } }
  // Копирование на новый набор (§3.3, §3.10): одна операция, отменяемая целиком.
  'curricula:copy': { in: CurriculumCopyInput; out: { operationId: number; curriculum: Curriculum } }

  // Строки плана (§3.1, §3.2). editPreview — «затронуто занятий: N после даты»
  // до того, как правка утверждённой строки создаст новую версию.
  'curriculumRows:list': { in: { curriculumId: number }; out: CurriculumRow[] }
  'curriculumRows:create': { in: CurriculumRowCreateInput; out: CurriculumRow }
  'curriculumRows:editPreview': { in: { id: number; effectiveFrom: string }; out: CurriculumRowEditPreview }
  'curriculumRows:edit': { in: CurriculumRowEditInput; out: { operationId: number; row: CurriculumRow; versioned: boolean } }
  'curriculumRows:delete': { in: { id: number }; out: { ok: true } }
  // Быстрый ручной ввод (§3.10): вставка диапазона из буфера — те же правила резолвинга
  // дисциплин, что и в мастере импорта (import/apply.ts), одной отменяемой операцией.
  'curriculumRows:bulkCreate': { in: CurriculumRowsBulkCreateInput; out: CurriculumRowsBulkCreateResult }

  // Недельная раскладка часов строки плана (§3.4): равномерно по умолчанию, правится вручную.
  'curriculumWeeks:list': { in: { curriculumRowId: number }; out: CurriculumWeek[] }
  'curriculumWeeks:generate': { in: { curriculumRowId: number; weekCount: number }; out: CurriculumWeek[] }
  'curriculumWeeks:save': {
    in: { curriculumRowId: number; weeks: { id: number; rowVersion: number; hours: number }[] }
    out: CurriculumWeek[]
  }

  // Нагрузка (§3.5, §3.6, §3.6a, §3.7a): назначение преподавателя на дисциплину+группу/поток/подгруппу.
  'teachingLoad:list': { in: { semesterId: number }; out: TeachingLoad[] }
  'teachingLoad:save': { in: TeachingLoadSaveInput; out: TeachingLoadSaveResult }
  'teachingLoad:delete': { in: { id: number }; out: { ok: true } }

  // Потоки (§3.5a): лекция на несколько групп одной специальности и курса одной строкой.
  'streams:listForSemester': { in: { semesterId: number }; out: StreamWithMembers[] }
  'streams:create': { in: StreamCreateInput; out: StreamWithMembers }
  'streams:disband': { in: { id: number }; out: { createdLoadIds: number[] } }

  // Прочие часы (§3.9a): вне сетки, в годовую нагрузку и отчёт входят, солвер не видит.
  'otherLoad:list': { in: { semesterId: number }; out: OtherLoad[] }
  'otherLoad:save': { in: OtherLoadSaveInput; out: OtherLoad }
  'otherLoad:delete': { in: { id: number }; out: { ok: true } }

  // Баланс нагрузки (§3.7): «сколько ещё не роздано» / «сколько набрано».
  'loadBalance:byGroup': { in: { semesterId: number }; out: GroupBalanceRow[] }
  'loadBalance:byTeacher': { in: { semesterId: number }; out: TeacherBalanceRow[] }

  // Шаблон расписания (§4.1–4.11): версии на семестр, записи 6×6, материализация.
  'scheduleTemplates:list': { in: { semesterId: number }; out: ScheduleTemplate[] }
  'scheduleTemplates:create': { in: ScheduleTemplateCreateInput; out: ScheduleTemplate }
  'scheduleTemplates:activate': { in: { id: number; rowVersion: number }; out: { ok: true } }
  'scheduleTemplates:archive': { in: { id: number; rowVersion: number }; out: { ok: true } }
  'scheduleTemplates:entries': { in: { templateId: number }; out: TemplateEntryView[] }
  'scheduleTemplates:unassignedLoad': { in: { templateId: number }; out: UnassignedLoadRow[] }
  'scheduleTemplates:placeEntry': { in: PlaceEntryInput; out: TemplateEntryView }
  'scheduleTemplates:moveEntry': { in: MoveEntryInput; out: TemplateEntryView }
  'scheduleTemplates:setLocked': { in: { id: number; rowVersion: number; isLocked: boolean }; out: { ok: true } }
  'scheduleTemplates:removeEntry': { in: { id: number; rowVersion: number }; out: { ok: true } }
  'scheduleTemplates:rolloutPreview': { in: RolloutRangeInput; out: RolloutPreview }
  'scheduleTemplates:rolloutApply': { in: RolloutRangeInput; out: RolloutApplyResult }
  'schedule:conflicts': { in: { dateFrom: string; dateTo: string }; out: ScheduleConflictView[] }

  // Мастер импорта (§3.8): файл → лист → область данных → сопоставление → предпросмотр → применение.
  'import:pickFile': { in: Record<string, never>; out: { filePath: string; fileName: string } | { cancelled: true } }
  'import:listSheets': { in: { filePath: string }; out: SheetInfo[] }
  'import:readGrid': { in: { filePath: string; sheetName: string }; out: Grid }
  'import:profiles:list': { in: { targetEntity?: TargetEntity }; out: ImportProfile[] }
  'import:profiles:save': { in: ImportProfileSaveInput; out: ImportProfile }
  'import:profiles:delete': { in: { id: number }; out: { ok: true } }
  // Операция вида 'import' (§1.5) — откатывается одной кнопкой на экране «Операции» (3.9).
  'import:apply': { in: ImportApplyInput; out: ImportApplyResult }
}

export interface SpecialitySaveInput {
  id?: number
  rowVersion?: number
  code: string
  name: string
  qualification: string | null
  semestersTotal: number
}

export interface CmcSaveInput {
  id?: number
  rowVersion?: number
  name: string
}

export interface BuildingSaveInput {
  id?: number
  rowVersion?: number
  name: string
  address: string | null
  isClinical: boolean
  clinicalMode: 'full_day' | 'block' | 'free' | null
}

export interface RoomSaveInput {
  id?: number
  rowVersion?: number
  buildingId: number
  number: string
  name: string | null
  capacity: number | null
  roomType: Room['roomType']
  validFrom: string
}

export interface DisciplineSaveInput {
  id?: number
  rowVersion?: number
  name: string
  indexCode: string | null
  block: 1 | 2 | 3
  cycle: Discipline['cycle']
  part: Discipline['part']
  difficulty: number
  defaultRoomType: Room['roomType'] | null
  requiresClinical: boolean
}

export interface TeacherSaveInput {
  id?: number
  rowVersion?: number
  lastName: string
  firstName: string
  middleName: string | null
  cmcId: number | null
  categoryId: number
  rate: number
  maxHoursYear: number | null
  maxPairsPerDay: number | null
  phone: string | null
  mainWorkplace: string | null
  availabilityNote: string | null
  hiredAt: string | null
  firedAt: string | null
  note: string | null
}

export interface TeacherQualificationCreateInput {
  teacherId: number
  disciplineId: number
  validFrom: string
}

export interface TeacherAbsenceCreateInput {
  teacherId: number
  kind: TeacherAbsence['kind']
  scope: TeacherAbsence['scope']
  dayOfWeek: number | null
  dateFrom: string | null
  dateTo: string | null
  pairFrom: number
  pairTo: number
  weight: number
  reason: string | null
}

export interface GroupSaveInput {
  id?: number
  rowVersion?: number
  name: string
  specialityId: number
  admissionYear: number
  course: number
  studentsCount: number
  maxPairsPerDay: number
  maxHoursPerWeek: number
  funding: StudyGroup['funding']
  validFrom: string
}

export interface AcademicYearSaveInput {
  id?: number
  rowVersion?: number
  name: string
  startsOn: string
  endsOn: string
}

export interface SemesterSaveInput {
  id?: number
  rowVersion?: number
  academicYearId: number
  no: 1 | 2
  startsOn: string
  endsOn: string
  weeksCount: number
  status: Semester['status']
}

export interface DivisionSchemeCreateInput {
  groupId: number
  semesterId: number
  name: string
  partsCount: 2 | 3
  isDefault: boolean
}

export interface CalendarPeriodSaveInput {
  id?: number
  rowVersion?: number
  kind: CalendarPeriod['kind']
  course: number | null
  specialityId: number | null
  groupId: number | null
  startsOn: string
  endsOn: string
  note: string | null
}

export interface CurriculumSaveInput {
  id?: number
  rowVersion?: number
  specialityId: number
  admissionYear: number
  name: string
}

export interface CurriculumCopyInput {
  fromCurriculumId: number
  specialityId: number
  admissionYear: number
  name: string
}

export interface CurriculumRowFields {
  disciplineId: number
  course: number
  semesterNo: number
  credits: number
  hoursTotal: number
  hoursClassroom: number
  hoursTheory: number
  hoursPractice: number
  hoursSeminar: number
  hoursLab: number
  hoursSrs: number
  controlSemester: number | null
}

export interface CurriculumRowCreateInput extends CurriculumRowFields {
  curriculumId: number
  validFrom: string
}

export interface CurriculumRowEditInput extends CurriculumRowFields {
  id: number
  rowVersion: number
  effectiveFrom: string
}

export interface CurriculumRowsBulkCreateInput {
  curriculumId: number
  rows: Record<string, Cell>[]
  validFrom: string
}

export interface TeachingLoadSaveInput {
  id?: number
  rowVersion?: number
  semesterId: number
  curriculumRowId: number
  teacherId: number
  groupId: number | null
  streamId: number | null
  divisionSchemeId: number | null
  subgroupId: number | null
  lessonKind: TeachingLoad['lessonKind']
  hoursPlanned: number
  requiresParallel: boolean
  roomTypeRequired: Room['roomType'] | null
  clinicalModeOverride: 'full_day' | 'block' | 'free' | null
  note: string | null
  validFrom: string
}

export interface StreamCreateInput {
  semesterId: number
  name: string
  groupIds: number[]
  validFrom: string
}

export interface OtherLoadSaveInput {
  id?: number
  rowVersion?: number
  semesterId: number
  teacherId: number
  kind: OtherLoad['kind']
  hours: number
  groupId: number | null
  note: string | null
}

export interface ScheduleTemplateCreateInput {
  semesterId: number
  effectiveFrom: string
  note: string | null
  copyFromTemplateId?: number | null
}

export interface PlaceEntryInput {
  templateId: number
  teachingLoadId: number
  dayOfWeek: number
  pairNo: number
  weekParity: TemplateEntryView['weekParity']
  roomId: number | null
}

export interface MoveEntryInput {
  id: number
  rowVersion: number
  dayOfWeek: number
  pairNo: number
  weekParity: TemplateEntryView['weekParity']
  roomId: number | null
}

export interface RolloutRangeInput {
  templateId: number
  dateFrom: string
  dateTo: string
}

export interface ImportProfileSaveInput {
  id?: number
  rowVersion?: number
  name: string
  targetEntity: TargetEntity
  mappingJson: string
}

export interface ImportApplyInput {
  targetEntity: TargetEntity
  rows: Record<string, Cell>[]
  curriculumId?: number
  semesterId?: number
  validFrom: string
}

export type IpcChannel = keyof IpcContract

export interface IpcEvents {
  'demo:compute:progress': { jobId: string; percent: number; iteration: number }
  'demo:compute:done': { jobId: string; placed: number; penalty: number }
}
