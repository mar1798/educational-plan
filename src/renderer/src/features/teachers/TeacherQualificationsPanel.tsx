import { useCallback, useEffect, useState } from 'react'
import type { Discipline, TeacherQualification } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess, notifyWarning } from '../../ui/toast'

interface TeacherQualificationsPanelProps {
  teacherId: number
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Историчная связь «преподаватель ↔ дисциплина» (§2.3), редактируется прямо на карточке преподавателя. */
export function TeacherQualificationsPanel({ teacherId }: TeacherQualificationsPanelProps) {
  const [disciplines, setDisciplines] = useState<Discipline[]>([])
  const [items, setItems] = useState<TeacherQualification[] | null>(null)
  const [disciplineId, setDisciplineId] = useState('')
  const [validFrom, setValidFrom] = useState(todayIso())

  const load = useCallback(
    () =>
      api.invoke('teacherQualifications:list', { teacherId }).then((res) => {
        if (res.ok) setItems(res.value)
      }),
    [teacherId],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void api.invoke('disciplines:list', {}).then((res) => {
      if (res.ok) setDisciplines(res.value)
    })
  }, [])

  function disciplineName(id: number): string {
    return disciplines.find((d) => d.id === id)?.name ?? `#${id}`
  }

  function add() {
    if (disciplineId === '') return
    api
      .invoke('teacherQualifications:create', { teacherId, disciplineId: Number(disciplineId), validFrom })
      .then((res) => {
        if (res.ok) {
          notifySuccess('Квалификация добавлена')
          setDisciplineId('')
          return load()
        }
        notifyError(res.error.message)
        return undefined
      })
  }

  function close(item: TeacherQualification) {
    api
      .invoke('teacherQualifications:close', { id: item.id, rowVersion: item.rowVersion, validTo: todayIso() })
      .then((res) => {
        if (!res.ok) {
          notifyError(res.error.message)
          return undefined
        }
        notifySuccess(ruCommon.closedOk)
        if (res.value.affectedLoadCount > 0) {
          notifyWarning(`Внимание: закрытие затронет назначенную нагрузку (${res.value.affectedLoadCount})`)
        }
        return load()
      })
  }

  return (
    <div className="subpanel">
      <h3>Квалификации</h3>
      {items === null && <p className="history-empty">{ruCommon.loading}</p>}
      {items?.length === 0 && <p className="history-empty">Квалификаций пока нет</p>}
      {items?.map((item) => (
        <div className="subpanel-row" key={item.id}>
          <span>
            {disciplineName(item.disciplineId)} — с {item.validFrom}
            {item.validTo ? ` по ${item.validTo}` : ''}
          </span>
          {!item.validTo && (
            <button className="btn-link" onClick={() => close(item)}>
              {ruCommon.close}
            </button>
          )}
        </div>
      ))}
      <div className="subpanel-add">
        <div className="form-field">
          <label>Дисциплина</label>
          <select value={disciplineId} onChange={(e) => setDisciplineId(e.target.value)}>
            <option value="">—</option>
            {disciplines.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>С даты</label>
          <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </div>
        <button type="button" className="btn" onClick={add} disabled={disciplineId === ''}>
          + Добавить
        </button>
      </div>
    </div>
  )
}
