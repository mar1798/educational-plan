/**
 * Типы входа/выхода солвера (§5.3, §5.7 PLAN.md). Модуль не знает ни про Drizzle, ни про
 * Electron — только числовые индексы, которые собирает `services/snapshot.ts` (главный
 * процесс) и потребляет `solver/greedy.ts` (чистый TypeScript, изоляция §3.4).
 */

export const DAYS = 6
export const PAIRS = 6
export const SLOTS = DAYS * PAIRS
/** Позиций студентов в группе — ровно столько, сколько бит в `BitMask64` (§5.3). */
export const POSITIONS = 64

export function slotIndex(day: number, pair: number): number {
  return (day - 1) * PAIRS + (pair - 1)
}

/**
 * Битовая маска на 64 позиций: слово [0] — биты 0..31, слово [1] — биты 32..63.
 * Используется и для масок слотов (0..35 из 64 доступных бит), и для масок позиций
 * студентов (0..63) — один и тот же формат, две разные семантики (§5.3).
 */
export type BitMask64 = readonly [number, number]

export const EMPTY_MASK: BitMask64 = [0, 0]

export interface Weights {
  studentGaps: number
  teacherGaps: number
  spread: number
  difficultyEarly: number
  clinicalGrouping: number
  teacherPreference: number
  latePair: number
  clinicalBlockStart: number
  roomMissing: number
  teacherDays: number
}

export const DEFAULT_WEIGHTS: Weights = {
  studentGaps: 10,
  teacherGaps: 8,
  spread: 5,
  difficultyEarly: 3,
  clinicalGrouping: 6,
  teacherPreference: 4,
  latePair: 2,
  clinicalBlockStart: 3,
  roomMissing: 20,
  teacherDays: 2,
}

export type WeightCode = keyof Weights

/** camelCase-поле `Weights` ↔ `constraint_weight.code` в БД (§4.3, snake_case) — единственное место сопоставления. */
export const WEIGHT_CODES: Record<WeightCode, string> = {
  studentGaps: 'student_gaps',
  teacherGaps: 'teacher_gaps',
  spread: 'spread',
  difficultyEarly: 'difficulty_early',
  clinicalGrouping: 'clinical_grouping',
  teacherPreference: 'teacher_preference',
  latePair: 'late_pair',
  clinicalBlockStart: 'clinical_block_start',
  roomMissing: 'room_missing',
  teacherDays: 'teacher_days',
}

export type RoomType = 'lecture' | 'practice' | 'seminar' | 'lab' | 'phantom' | 'computer' | 'gym'
export type ClinicalMode = 'full_day' | 'block' | 'free'
export type Parity = 'all' | 'odd' | 'even'
export type LessonKind = 'theory' | 'practice' | 'seminar' | 'lab'

/** Одна запись «мягкой» недоступности преподавателя (`teacher_absence.kind = 'soft'`) — §5.5 `teacher_preference`. */
export interface SoftUnavailability {
  mask: BitMask64
  weight: number
}

export interface TeacherInfo {
  idx: number
  id: number
  /** Биты слотов, где преподаватель ЗАНЯТ жёстко (кроме собственно занятий) — недоступность §4.3. */
  unavailable: BitMask64
  /** «Мягкая» недоступность (§4.3 `kind='soft'`): нарушение штрафуется, а не запрещается. */
  softUnavailable: readonly SoftUnavailability[]
  maxPairsPerDay: number | null
}

export interface RoomInfo {
  idx: number
  id: number
  capacity: number | null
  roomType: RoomType
  buildingIdx: number
}

export interface BuildingInfo {
  idx: number
  id: number
  clinicalMode: ClinicalMode | null
}

export interface GroupInfo {
  idx: number
  id: number
  studentsCount: number
  maxPairsPerDay: number
  maxHoursPerWeek: number
}

export interface SlotInfo {
  idx: number
  day: number
  pair: number
  enabled: boolean
  academicHours: number
}

export interface UnitAttendee {
  groupIdx: number
  /** Позиции студентов группы, занятые этим юнитом (0-based, включительно). */
  memberMask: BitMask64
}

export interface Unit {
  id: number
  loadIdx: number
  teacherIdx: number
  attendees: readonly UnitAttendee[]
  disciplineIdx: number
  difficulty: number
  roomTypeRequired: RoomType | null
  roomIdFixed: number | null
  buildingIdxRequired: number | null
  roomOptional: boolean
  clinicalMode: ClinicalMode | null
  students: number
  lessonKind: LessonKind
  parity: Parity
  pairedUnitId: number | null
}

export interface Assignment {
  unitId: number
  slot: number
  roomIdx: number | null
}

/**
 * Уже стоящая (`is_locked=1`) запись шаблона: несёт те же поля, что и `Unit` (нужны, чтобы
 * засеять занятость перед расстановкой — §5.3), плюс уже известные `slot`/`roomIdx`. Такие
 * записи не входят в `units` и не двигаются солвером.
 */
export interface FixedPlacement extends Unit {
  slot: number
  roomIdx: number | null
}

export type BlockReason =
  | 'slot_disabled'
  | 'teacher_unavailable'
  | 'teacher_busy'
  | 'student_busy'
  | 'room_busy'
  | 'room_capacity'
  | 'room_type'
  | 'building_mismatch'
  | 'group_day_limit'
  | 'teacher_day_limit'
  | 'group_week_hours'
  | 'clinical_conflict'
  | 'no_room_candidate'

export interface SolverLimits {
  timeBudgetMs: number
  maxIterations: number
  seed: number
}

export interface SolverInput {
  units: Unit[]
  teachers: TeacherInfo[]
  rooms: RoomInfo[]
  buildings: BuildingInfo[]
  groups: GroupInfo[]
  slots: SlotInfo[]
  fixed: FixedPlacement[]
  weights: Weights
  limits: SolverLimits
}

export type UnplacedReason = 'no_free_slot' | 'no_suitable_room' | 'teacher_unavailable' | 'group_day_limit' | 'paired_unit_failed'

export interface UnplacedUnit {
  unitId: number
  reason: UnplacedReason
  details: {
    triedSlots: number
    blockedBy: BlockReason[]
  }
}

export type StopReason = 'completed' | 'time_budget' | 'max_iterations' | 'no_improvement' | 'cancelled'

export interface SolverOutput {
  assignments: Assignment[]
  unplaced: UnplacedUnit[]
  penalty: number
  breakdown: Record<string, number>
  iterations: number
  elapsedMs: number
  stoppedBy: StopReason
}

export interface SolverProgress {
  percent: number
  iteration: number
  placed: number
  total: number
  phase: 'greedy' | 'search'
}

export interface SolverHooks {
  onProgress?: (progress: SolverProgress) => void
  isCancelled?: () => boolean
}
