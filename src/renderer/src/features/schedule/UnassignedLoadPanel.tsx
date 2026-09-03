import { useDraggable } from '@dnd-kit/core'
import type { UnassignedLoadRow } from '../../../../shared/ipc/contract'
import type { DragPayload } from './types'

const KIND_LABEL: Record<UnassignedLoadRow['lessonKind'], string> = {
  theory: 'Теория',
  practice: 'Практика',
  seminar: 'Семинар',
  lab: 'Лаборатория',
}

function UnassignedCard({ row }: { row: UnassignedLoadRow }) {
  const payload: DragPayload = { kind: 'load', teachingLoadId: row.teachingLoadId, teacherId: row.teacherId, attendees: row.attendees }
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `load:${row.teachingLoadId}`, data: payload })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className={`unassigned-card${isDragging ? ' unassigned-card-dragging' : ''}`}>
      <div className="schedule-chip-title">{row.disciplineName}</div>
      <div className="schedule-chip-sub">{row.teacherName}</div>
      <div className="schedule-chip-sub">{row.targetLabel} · {KIND_LABEL[row.lessonKind]}</div>
      <div className="unassigned-card-hours">осталось {row.hoursRemaining} ч из {row.hoursPlanned}</div>
    </div>
  )
}

/** Панель нераспределённой нагрузки (§4.3): карточки перетаскиваются в сетку тем же DndContext. */
export function UnassignedLoadPanel({ rows }: { rows: UnassignedLoadRow[] }) {
  return (
    <div className="unassigned-panel">
      <h3>Не распределено</h3>
      {rows.length === 0 ? (
        <p className="history-empty">Вся нагрузка расставлена</p>
      ) : (
        rows.map((row) => <UnassignedCard key={row.teachingLoadId} row={row} />)
      )}
    </div>
  )
}
