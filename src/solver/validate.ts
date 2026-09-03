/**
 * Единственный источник истины по жёстким конфликтам «преподаватель / кабинет /
 * пересечение подгрупп» (§4.4, §4.6, §5.8 PLAN.md). Используется в renderer при
 * перетаскивании, в main как авторитетная проверка перед записью и при сканировании
 * конфликтов среди уже материализованных занятий — везде один и тот же модуль.
 *
 * Остальные жёсткие ограничения солвера (лимиты пар/часов, режим full_day) — часть
 * этапа 5 (генерация) и здесь не нужны: этап 4 закрывает только ручную расстановку.
 */

export interface SlotAttendee {
  groupId: number
  posFrom: number
  posTo: number
}

export interface SlotEntry {
  id: number
  dayOfWeek: number
  pairNo: number
  weekParity: 'all' | 'odd' | 'even'
  teacherId: number
  roomId: number | null
  attendees: SlotAttendee[]
}

export type ConflictReason =
  | { kind: 'teacher_busy'; withEntryId: number; teacherId: number }
  | { kind: 'room_busy'; withEntryId: number; roomId: number }
  | { kind: 'student_overlap'; withEntryId: number; groupId: number; overlapFrom: number; overlapTo: number }

function parityOverlaps(a: SlotEntry['weekParity'], b: SlotEntry['weekParity']): boolean {
  return a === 'all' || b === 'all' || a === b
}

function studentOverlaps(candidate: SlotEntry, other: SlotEntry): ConflictReason[] {
  const reasons: ConflictReason[] = []
  for (const a of candidate.attendees) {
    for (const b of other.attendees) {
      if (a.groupId !== b.groupId) continue
      const from = Math.max(a.posFrom, b.posFrom)
      const to = Math.min(a.posTo, b.posTo)
      if (from <= to) {
        reasons.push({ kind: 'student_overlap', withEntryId: other.id, groupId: a.groupId, overlapFrom: from, overlapTo: to })
      }
    }
  }
  return reasons
}

/**
 * Жёсткие конфликты кандидата `candidate` с уже расставленными записями `others`
 * (кандидат исключается вызывающей стороной, если он уже есть среди `others`).
 */
export function findConflicts(candidate: SlotEntry, others: SlotEntry[]): ConflictReason[] {
  const reasons: ConflictReason[] = []

  for (const other of others) {
    if (other.id === candidate.id) continue
    if (other.dayOfWeek !== candidate.dayOfWeek || other.pairNo !== candidate.pairNo) continue
    if (!parityOverlaps(candidate.weekParity, other.weekParity)) continue

    if (other.teacherId === candidate.teacherId) {
      reasons.push({ kind: 'teacher_busy', withEntryId: other.id, teacherId: other.teacherId })
    }
    if (candidate.roomId != null && other.roomId != null && candidate.roomId === other.roomId) {
      reasons.push({ kind: 'room_busy', withEntryId: other.id, roomId: other.roomId })
    }
    reasons.push(...studentOverlaps(candidate, other))
  }

  return reasons
}
