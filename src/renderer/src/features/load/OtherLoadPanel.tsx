import { useCallback, useEffect, useState } from 'react'
import type { OtherLoad, Teacher } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'

interface OtherLoadPanelProps {
  semesterId: number
}

const KIND_LABEL: Record<OtherLoad['kind'], string> = {
  test: 'Тест',
  method: 'Методическая работа',
  iga: 'ИГА',
  other: 'Прочее',
}

/**
 * Прочие часы (§3.9a): тест, методические, ИГА — в годовую нагрузку и отчёт входят,
 * в сетку расписания солвер их не ставит (§1.1 п.36).
 */
export function OtherLoadPanel({ semesterId }: OtherLoadPanelProps) {
  const [rows, setRows] = useState<OtherLoad[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [teacherId, setTeacherId] = useState<number | ''>('')
  const [kind, setKind] = useState<OtherLoad['kind']>('test')
  const [hours, setHours] = useState(1)

  const refresh = useCallback(
    () =>
      api.invoke('otherLoad:list', { semesterId }).then((res) => {
        if (res.ok) setRows(res.value)
        else notifyError(res.error.message)
      }),
    [semesterId],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void api.invoke('teachers:list', {}).then((res) => res.ok && setTeachers(res.value))
  }, [])

  const teacherName = (id: number) => {
    const t = teachers.find((x) => x.id === id)
    return t ? `${t.lastName} ${t.firstName}` : `#${id}`
  }

  async function add() {
    if (teacherId === '') return
    const res = await api.invoke('otherLoad:save', { semesterId, teacherId, kind, hours, groupId: null, note: null })
    if (res.ok) {
      notifySuccess(ruCommon.savedOk)
      setHours(1)
      await refresh()
    } else {
      notifyError(res.error.message)
    }
  }

  async function remove(id: number) {
    const res = await api.invoke('otherLoad:delete', { id })
    if (res.ok) {
      notifySuccess(ruCommon.deletedOk)
      await refresh()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <div className="subpanel">
      <h3>Прочие часы</h3>
      {rows.length === 0 && <p className="history-empty">Прочих часов в этом семестре не заведено</p>}
      {rows.map((r) => (
        <div className="subpanel-row" key={r.id}>
          <span>
            {teacherName(r.teacherId)} — {KIND_LABEL[r.kind]} — {r.hours} ч
          </span>
          <button type="button" className="btn-link" onClick={() => void remove(r.id)}>
            {ruCommon.delete}
          </button>
        </div>
      ))}

      <div className="subpanel-add">
        <div className="form-field">
          <label>Преподаватель</label>
          <select value={teacherId} onChange={(e) => setTeacherId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">—</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.lastName} {t.firstName}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>Вид</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as OtherLoad['kind'])}>
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>Часы</label>
          <input type="number" min={1} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        </div>
        <button type="button" className="btn" disabled={teacherId === ''} onClick={() => void add()}>
          + Добавить
        </button>
      </div>
    </div>
  )
}
