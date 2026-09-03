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
