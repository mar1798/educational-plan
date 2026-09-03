import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { TemplateEntryView } from '../../../../shared/ipc/contract'
import { WEEKDAY_LABEL } from '../../ui/locale'
import { cellId, type DragPayload } from './types'

interface EntryChipProps {
  entry: TemplateEntryView
  onClick: () => void
  onToggleLock: () => void
}

function EntryChip({ entry, onClick, onToggleLock }: EntryChipProps) {
  const payload: DragPayload = {
    kind: 'entry',
    entryId: entry.id,
    rowVersion: entry.rowVersion,
    teacherId: entry.teacherId,
    roomId: entry.roomId,
    weekParity: entry.weekParity,
    attendees: entry.attendees,
  }
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `entry:${entry.id}`,
    data: payload,
    disabled: entry.isLocked,
  })

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`schedule-chip${entry.isLocked ? ' schedule-chip-locked' : ''}${isDragging ? ' schedule-chip-dragging' : ''}`}
      onClick={onClick}
    >
      <button
        type="button"
        className="schedule-chip-lock"
        onClick={(ev) => {
          ev.stopPropagation()
          onToggleLock()
        }}
        title={entry.isLocked ? 'Снять закрепление' : 'Закрепить занятие'}
      >
        {entry.isLocked ? '🔒' : '🔓'}
      </button>
      <div className="schedule-chip-body">
        <div className="schedule-chip-title">{entry.disciplineName}</div>
        <div className="schedule-chip-sub">{entry.teacherName}</div>
        <div className="schedule-chip-sub">
          {entry.targetLabel}
          {entry.roomLabel ? ` · ${entry.roomLabel}` : ''}
        </div>
      </div>
    </div>
  )
}

interface GridCellProps {
  dayOfWeek: number
  pairNo: number
  entries: TemplateEntryView[]
  isConflict: boolean
  conflictMessage: string | null
  onEntryClick: (entry: TemplateEntryView) => void
  onToggleLock: (entry: TemplateEntryView) => void
}

function GridCell({ dayOfWeek, pairNo, entries, isConflict, conflictMessage, onEntryClick, onToggleLock }: GridCellProps) {
  const id = cellId(dayOfWeek, pairNo)
  const { setNodeRef, isOver } = useDroppable({ id })

  const classes = ['schedule-cell']
  if (isOver) classes.push('schedule-cell-over')
  if (isConflict) classes.push('schedule-cell-conflict')

  return (
    <div ref={setNodeRef} className={classes.join(' ')} title={isConflict ? (conflictMessage ?? undefined) : undefined}>
      {entries.map((e) => (
        <EntryChip key={e.id} entry={e} onClick={() => onEntryClick(e)} onToggleLock={() => onToggleLock(e)} />
      ))}
    </div>
  )
}

interface ScheduleGridProps {
  /** Пн–Сб в режиме «неделя», один день — в режиме «день» (задача 4.6). */
  days: number[]
  pairNumbers: number[]
  pairLabel: (pairNo: number) => string
  entries: TemplateEntryView[]
  hoverConflictCellKey: string | null
  hoverConflictMessage: string | null
  onEntryClick: (entry: TemplateEntryView) => void
  onToggleLock: (entry: TemplateEntryView) => void
}

/** Сетка Пн–Сб × пары (§1.1 «единая сетка 36 слотов», задачи 4.2, 4.6): один DndContext выше по дереву. */
export function ScheduleGrid({ days, pairNumbers, pairLabel, entries, hoverConflictCellKey, hoverConflictMessage, onEntryClick, onToggleLock }: ScheduleGridProps) {
  const entriesByCell = new Map<string, TemplateEntryView[]>()
  for (const e of entries) {
    const key = cellId(e.dayOfWeek, e.pairNo)
    const arr = entriesByCell.get(key) ?? []
    arr.push(e)
    entriesByCell.set(key, arr)
  }

  return (
    // minmax(0, 1fr), а не 1fr: у 1fr минимум равен min-content, и длинное название вроде
    // «Неотложная помощь на догоспитальном этапе» распирает колонки шире контейнера — сетка
    // вылезала вправо и последний день недели уходил под панель нераспределённых (§4.2).
    <div className="schedule-grid" style={{ gridTemplateColumns: `80px repeat(${days.length}, minmax(0, 1fr))` }}>
      <div className="schedule-grid-corner" />
      {days.map((d) => (
        <div key={`h-${d}`} className="schedule-grid-day-header">
          {WEEKDAY_LABEL[d]}
        </div>
      ))}
      {pairNumbers.flatMap((pairNo) => [
        <div key={`p-${pairNo}`} className="schedule-grid-pair-header">
          {pairLabel(pairNo)}
        </div>,
        ...days.map((d) => {
          const key = cellId(d, pairNo)
          return (
            <GridCell
              key={key}
              dayOfWeek={d}
              pairNo={pairNo}
              entries={entriesByCell.get(key) ?? []}
              isConflict={hoverConflictCellKey === key}
              conflictMessage={hoverConflictCellKey === key ? hoverConflictMessage : null}
              onEntryClick={onEntryClick}
              onToggleLock={onToggleLock}
            />
          )
        }),
      ])}
    </div>
  )
}
