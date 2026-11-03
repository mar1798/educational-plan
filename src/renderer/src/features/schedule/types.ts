import type { TemplateEntryAttendee } from '../../../../shared/ipc/contract'

/**
 * Данные, которые dnd-kit переносит между drag-источником и обработчиком дропа (§4.2–4.4):
 * карточка нераспределённой нагрузки ещё не стоит в сетке, у неё нет ни слота, ни кабинета.
 */
export type DragPayload =
  | { kind: 'load'; teachingLoadId: number; teacherId: number; attendees: TemplateEntryAttendee[] }
  | {
      kind: 'entry'
      entryId: number
      rowVersion: number
      teacherId: number
      roomId: number | null
      weekParity: 'all' | 'odd' | 'even'
      attendees: TemplateEntryAttendee[]
      /** Колонка сводной сетки, из которой взяли карточку: дроп в чужую колонку игнорируется. */
      sourceGroupId?: number
    }

export function cellId(dayOfWeek: number, pairNo: number): string {
  return `cell:${dayOfWeek}:${pairNo}`
}

export function parseCellId(id: string): { dayOfWeek: number; pairNo: number } | null {
  const m = /^cell:(\d+):(\d+)$/.exec(id)
  if (!m) return null
  return { dayOfWeek: Number(m[1]), pairNo: Number(m[2]) }
}

/** Ячейка сводной сетки: день × пара × группа. Перенос разрешён только внутри колонки своей группы. */
export function summaryCellId(dayOfWeek: number, pairNo: number, groupId: number): string {
  return `scell:${dayOfWeek}:${pairNo}:${groupId}`
}

export function parseSummaryCellId(id: string): { dayOfWeek: number; pairNo: number; groupId: number } | null {
  const m = /^scell:(\d+):(\d+):(\d+)$/.exec(id)
  if (!m) return null
  return { dayOfWeek: Number(m[1]), pairNo: Number(m[2]), groupId: Number(m[3]) }
}
