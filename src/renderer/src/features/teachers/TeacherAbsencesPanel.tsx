import { useCallback, useEffect, useState } from 'react'
import type { TeacherAbsence } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { ruCommon, WEEKDAY_LABEL } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'
import { Select } from '../../ui/Select'

interface TeacherAbsencesPanelProps {
  teacherId: number
}

const KIND_LABEL: Record<TeacherAbsence['kind'], string> = { hard: 'Нельзя ставить', soft: 'Нежелательно' }

function summarize(item: TeacherAbsence): string {
  const when =
    item.scope === 'weekday'
      ? `по ${WEEKDAY_LABEL[item.dayOfWeek ?? 0] ?? item.dayOfWeek}`
      : `${item.dateFrom} — ${item.dateTo}`
  return `${KIND_LABEL[item.kind]}, ${when}, пары ${item.pairFrom}–${item.pairTo}${item.reason ? ` (${item.reason})` : ''}`
}

interface DraftState {
  kind: TeacherAbsence['kind']
  scope: TeacherAbsence['scope']
  dayOfWeek: string
  dateFrom: string
  dateTo: string
  pairFrom: number
  pairTo: number
  weight: number
  reason: string
}

const initialDraft: DraftState = {
  kind: 'hard',
  scope: 'weekday',
  dayOfWeek: '1',
  dateFrom: '',
  dateTo: '',
  pairFrom: 1,
  pairTo: 6,
  weight: 100,
  reason: '',
}

/** Недоступность преподавателя (§2.3): «Иванова не ведёт по средам». */
export function TeacherAbsencesPanel({ teacherId }: TeacherAbsencesPanelProps) {
  const [items, setItems] = useState<TeacherAbsence[] | null>(null)
  const [draft, setDraft] = useState<DraftState>(initialDraft)

  const load = useCallback(
    () =>
      api.invoke('teacherAbsences:list', { teacherId }).then((res) => {
        if (res.ok) setItems(res.value)
      }),
    [teacherId],
  )

  useEffect(() => {
    void load()
  }, [load])

  function add() {
    const payload = {
      teacherId,
      kind: draft.kind,
      scope: draft.scope,
      dayOfWeek: draft.scope === 'weekday' ? Number(draft.dayOfWeek) : null,
      dateFrom: draft.scope === 'date_range' ? draft.dateFrom : null,
      dateTo: draft.scope === 'date_range' ? draft.dateTo : null,
      pairFrom: draft.pairFrom,
      pairTo: draft.pairTo,
      weight: draft.weight,
      reason: draft.reason === '' ? null : draft.reason,
    }
    api.invoke('teacherAbsences:create', payload).then((res) => {
      if (!res.ok) {
        notifyError(res.error.message)
        return undefined
      }
      notifySuccess('Запись добавлена')
      setDraft(initialDraft)
      return load()
    })
  }

  function remove(id: number) {
    api.invoke('teacherAbsences:delete', { id }).then((res) => {
      if (!res.ok) {
        notifyError(res.error.message)
        return undefined
      }
      notifySuccess(ruCommon.deletedOk)
      return load()
    })
  }

  return (
    <div className="subpanel">
      <h3>Недоступность</h3>
      {items === null && <p className="history-empty">{ruCommon.loading}</p>}
      {items?.length === 0 && <p className="history-empty">Ограничений нет</p>}
      {items?.map((item) => (
        <div className="subpanel-row" key={item.id}>
          <span>{summarize(item)}</span>
          <button className="btn-link" onClick={() => remove(item.id)}>
            {ruCommon.delete}
          </button>
        </div>
      ))}
      <div className="subpanel-add">
        <div className="form-field">
          <label>Тип</label>
          <Select value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v as TeacherAbsence['kind'] })}>
            <option value="hard">Нельзя ставить</option>
            <option value="soft">Нежелательно</option>
          </Select>
        </div>
        <div className="form-field">
          <label>Когда</label>
          <Select value={draft.scope} onChange={(v) => setDraft({ ...draft, scope: v as TeacherAbsence['scope'] })}>
            <option value="weekday">По дню недели</option>
            <option value="date_range">Период дат</option>
          </Select>
        </div>
        {draft.scope === 'weekday' ? (
          <div className="form-field">
            <label>День недели</label>
            <Select value={draft.dayOfWeek} onChange={(v) => setDraft({ ...draft, dayOfWeek: v })}>
              {Object.entries(WEEKDAY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <>
            <div className="form-field">
              <label>С</label>
              <input type="date" value={draft.dateFrom} onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })} />
            </div>
            <div className="form-field">
              <label>По</label>
              <input type="date" value={draft.dateTo} onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })} />
            </div>
          </>
        )}
        <div className="form-field">
          <label>Пары с–по</label>
          <div className="pair-range">
            <input
              type="number"
              min={1}
              max={6}
              value={draft.pairFrom}
              onChange={(e) => setDraft({ ...draft, pairFrom: Number(e.target.value) })}
            />
            <input
              type="number"
              min={1}
              max={6}
              value={draft.pairTo}
              onChange={(e) => setDraft({ ...draft, pairTo: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="form-field">
          <label>Причина</label>
          <input type="text" value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
        </div>
        <button type="button" className="btn" onClick={add}>
          + Добавить
        </button>
      </div>
    </div>
  )
}
