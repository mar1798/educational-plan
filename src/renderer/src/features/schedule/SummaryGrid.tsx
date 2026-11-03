import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useMemo } from 'react'
import type { SummaryGroupColumn, TemplateEntryView } from '../../../../shared/ipc/contract'
import { buildSummaryCell } from '../../../../shared/schedule/summary-cell'
import { WEEKDAY_LABEL } from '../../ui/locale'
import { summaryCellId, type DragPayload } from './types'

interface PartProps {
  entries: TemplateEntryView[]
  groupId: number
  onEntryClick: (entry: TemplateEntryView) => void
  onToggleLock: (entry: TemplateEntryView) => void
}

/**
 * Карточка ячейки. Тянется только занятие, собранное из одной записи: «Кырг. яз. / Ин. яз.» —
 * это две записи, и двигать «половинку» вслепую значило бы разорвать пару подгрупп, поэтому
 * для составной части открывается диалог, а перенос делается из среза по группе.
 */
function SummaryChip({
  entries,
  groupId,
  entryIds,
  top,
  bottom,
  isStream,
  onEntryClick,
  onToggleLock,
}: PartProps & {
  entryIds: number[]
  top: string
  bottom: string
  isStream: boolean
}) {
  const own = entries.filter((e) => entryIds.includes(e.id))
  const single = own.length === 1 ? own[0]! : null
  const payload: DragPayload | undefined = single
    ? {
        kind: 'entry',
        entryId: single.id,
        rowVersion: single.rowVersion,
        teacherId: single.teacherId,
        roomId: single.roomId,
        weekParity: single.weekParity,
        attendees: single.attendees,
        sourceGroupId: groupId,
      }
    : undefined
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `sentry:${groupId}:${entryIds.join('+')}`,
    data: payload,
    disabled: !single || single.isLocked,
  })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
  const locked = own.some((e) => e.isLocked)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`summary-chip${locked ? ' schedule-chip-locked' : ''}${isDragging ? ' schedule-chip-dragging' : ''}`}
      title={own.map((e) => `${e.disciplineName} — ${e.teacherName}${e.roomLabel ? `, каб. ${e.roomLabel}` : ''}`).join('\n')}
      onClick={() => own[0] && onEntryClick(own[0])}
    >
      <div className="summary-chip-top">
        {top}
        {isStream && <span className="summary-chip-flag"> · поток</span>}
        {single && (
          <button
            type="button"
            className="summary-chip-lock"
            onClick={(ev) => {
              ev.stopPropagation()
              onToggleLock(single)
            }}
            title={single.isLocked ? 'Снять закрепление' : 'Закрепить занятие'}
          >
            {single.isLocked ? '🔒' : '🔓'}
          </button>
        )}
      </div>
      <div className="summary-chip-bottom">{bottom}</div>
    </div>
  )
}

function SummaryCell({
  day,
  pairNo,
  groupId,
  entries,
  conflict,
  conflictMessage,
  onEntryClick,
  onToggleLock,
}: {
  day: number
  pairNo: number
  groupId: number
  entries: TemplateEntryView[]
  conflict: boolean
  conflictMessage: string | null
  onEntryClick: (entry: TemplateEntryView) => void
  onToggleLock: (entry: TemplateEntryView) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: summaryCellId(day, pairNo, groupId),
  })
  const parts = useMemo(() => buildSummaryCell(entries, groupId), [entries, groupId])
  const classes = ['summary-cell']
  if (isOver) classes.push('schedule-cell-over')
  if (conflict) classes.push('schedule-cell-conflict')
  return (
    <div ref={setNodeRef} className={classes.join(' ')} title={conflict ? (conflictMessage ?? undefined) : undefined}>
      {parts.map((p) => (
        <SummaryChip
          key={p.entryIds.join('+')}
          entries={entries}
          groupId={groupId}
          entryIds={p.entryIds}
          top={p.top}
          bottom={p.bottom}
          isStream={p.isStream}
          onEntryClick={onEntryClick}
          onToggleLock={onToggleLock}
        />
      ))}
    </div>
  )
}

interface SummaryGridProps {
  columns: SummaryGroupColumn[]
  days: number[]
  pairNumbers: number[]
  pairLabel: (pairNo: number) => string
  entries: TemplateEntryView[]
  hoverConflictCellKey: string | null
  hoverConflictMessage: string | null
  onEntryClick: (entry: TemplateEntryView) => void
  onToggleLock: (entry: TemplateEntryView) => void
}

/**
 * Сводная сетка колледжа: слева день и пара, сверху группы (§этап А). Шапка и левые колонки
 * закреплены (`position: sticky`), потому что 31 колонка на экран не помещается.
 */
export function SummaryGrid({ columns, days, pairNumbers, pairLabel, entries, hoverConflictCellKey, hoverConflictMessage, onEntryClick, onToggleLock }: SummaryGridProps) {
  const byCell = useMemo(() => {
    const map = new Map<string, TemplateEntryView[]>()
    for (const e of entries) {
      for (const groupId of new Set(e.attendees.map((a) => a.groupId))) {
        const key = summaryCellId(e.dayOfWeek, e.pairNo, groupId)
        const arr = map.get(key)
        if (arr) arr.push(e)
        else map.set(key, [e])
      }
    }
    return map
  }, [entries])

  if (columns.length === 0) return <p className="history-empty">Нет групп под выбранный фильтр</p>

  return (
    <div className="summary-scroll">
      <div
        className="summary-grid"
        style={{
          gridTemplateColumns: `36px 64px repeat(${columns.length}, minmax(120px, 1fr))`,
        }}
      >
        <div className="summary-head summary-sticky-top summary-sticky-left summary-corner">День</div>
        <div className="summary-head summary-sticky-top summary-sticky-left2 summary-corner">Пара</div>
        {columns.map((c) => (
          <div key={c.id} className="summary-head summary-sticky-top" title={c.specialityName}>
            {c.name}
          </div>
        ))}
        {days.flatMap((d) =>
          pairNumbers.flatMap((pairNo, idx) => [
            idx === 0 ? (
              <div key={`d-${d}`} className="summary-day summary-sticky-left" style={{ gridRow: `span ${pairNumbers.length}` }}>
                <span>{WEEKDAY_LABEL[d]}</span>
              </div>
            ) : null,
            <div key={`p-${d}-${pairNo}`} className="summary-pair summary-sticky-left2" style={idx === 0 ? undefined : { gridColumn: 2 }}>
              {pairLabel(pairNo)}
            </div>,
            ...columns.map((c) => {
              const key = summaryCellId(d, pairNo, c.id)
              return (
                <SummaryCell
                  key={key}
                  day={d}
                  pairNo={pairNo}
                  groupId={c.id}
                  entries={byCell.get(key) ?? []}
                  conflict={hoverConflictCellKey === key}
                  conflictMessage={hoverConflictCellKey === key ? hoverConflictMessage : null}
                  onEntryClick={onEntryClick}
                  onToggleLock={onToggleLock}
                />
              )
            }),
          ]),
        )}
      </div>
    </div>
  )
}
