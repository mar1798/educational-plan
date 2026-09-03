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
    }

export function cellId(dayOfWeek: number, pairNo: number): string {
  return `cell:${dayOfWeek}:${pairNo}`
}

export function parseCellId(id: string): { dayOfWeek: number; pairNo: number } | null {
  const m = /^cell:(\d+):(\d+)$/.exec(id)
  if (!m) return null
  return { dayOfWeek: Number(m[1]), pairNo: Number(m[2]) }
}
