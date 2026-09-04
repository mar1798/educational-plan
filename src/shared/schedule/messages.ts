import type { BlockReason, Unit, UnplacedReason, UnplacedUnit } from '../../solver/model'
import type { ConflictReason } from '../../solver/validate'

/**
 * Имена подставляются вызывающей стороной (main знает БД, renderer — уже загруженные
 * справочники), сам модуль остаётся общим текстом для обеих сторон (§4.4, §5.8 PLAN.md):
 * один и тот же текст конфликта в подсказке при перетаскивании и в ошибке от main.
 */
export interface ConflictNameResolver {
  teacherName(id: number): string
  groupName(id: number): string
  roomLabel(id: number): string
  /** Чем занят слот у конфликтующей записи: «32 ЛД» / «англ. п/гр 1» (§4.4). */
  entryLabel(id: number): string
}

export function describeConflict(reason: ConflictReason, names: ConflictNameResolver): string {
  switch (reason.kind) {
    case 'teacher_busy':
      return `${names.teacherName(reason.teacherId)} ведёт в это время ${names.entryLabel(reason.withEntryId)}`
    case 'room_busy':
      return `Кабинет ${names.roomLabel(reason.roomId)} занят в это время: ${names.entryLabel(reason.withEntryId)}`
    case 'student_overlap':
      return `Пересечение с ${names.entryLabel(reason.withEntryId)}: ${reason.overlapTo - reason.overlapFrom + 1} студентов`
  }
}

export function describeConflicts(reasons: ConflictReason[], names: ConflictNameResolver): string {
  return reasons.map((r) => describeConflict(r, names)).join('; ')
}

/**
 * Человеческая причина отказа солвера (§5.7 PLAN.md): экран «Не удалось разместить»
 * показывает конкретный дефицит ресурса, а не «не удалось составить расписание».
 */
export interface UnplacedNameResolver {
  teacherName(idx: number): string
  disciplineName(idx: number): string
  targetLabel(unit: Unit): string
}

const UNPLACED_REASON_LABEL: Record<UnplacedReason, string> = {
  no_free_slot: 'не нашлось свободного слота',
  no_suitable_room: 'не нашлось подходящего кабинета',
  teacher_unavailable: 'преподаватель недоступен во всех проверенных слотах',
  group_day_limit: 'упирается в лимит пар или часов в день',
  paired_unit_failed: 'не удалось поставить парой со второй подгруппой в один слот',
}

const BLOCK_REASON_LABEL: Record<BlockReason, string> = {
  slot_disabled: 'слот выключен',
  teacher_unavailable: 'преподаватель недоступен',
  teacher_busy: 'преподаватель занят',
  student_busy: 'студенты уже заняты',
  room_busy: 'кабинет занят',
  room_capacity: 'не хватает вместимости кабинета',
  room_type: 'не тот тип кабинета',
  room_fixed: 'занятие закреплено за другим кабинетом',
  building_mismatch: 'кабинет не в нужном здании',
  group_day_limit: 'лимит пар в день у группы',
  teacher_day_limit: 'лимит пар в день у преподавателя',
  group_week_hours: 'недельный лимит часов у группы',
  clinical_conflict: 'день уже занят другой клинической базой',
  no_room_candidate: 'нет ни одного подходящего кабинета',
}

export function describeUnplaced(unit: Unit, item: UnplacedUnit, names: UnplacedNameResolver): string {
  const who = `${names.teacherName(unit.teacherIdx)} — ${names.disciplineName(unit.disciplineIdx)}, ${names.targetLabel(unit)}`
  const reason = UNPLACED_REASON_LABEL[item.reason]
  const uniqueBlocks = [...new Set(item.details.blockedBy)]
  const blocked = uniqueBlocks.length > 0 ? ` (мешало: ${uniqueBlocks.map((b) => BLOCK_REASON_LABEL[b]).join(', ')})` : ''
  return `${who}: ${reason}${blocked}`
}
