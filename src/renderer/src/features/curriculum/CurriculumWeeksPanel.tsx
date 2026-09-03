import { useCallback, useEffect, useState } from 'react'
import type { CurriculumWeek } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'

interface CurriculumWeeksPanelProps {
  curriculumRowId: number
  hoursClassroom: number
}

interface WeekDraft {
  id: number
  rowVersion: number
  hours: string
}

function draftsFromWeeks(weeks: CurriculumWeek[]): WeekDraft[] {
  return weeks.map((w) => ({ id: w.id, rowVersion: w.rowVersion, hours: String(w.hours) }))
}

/**
 * Недельная раскладка часов строки плана (§3.4): равномерно по умолчанию
 * (computeEvenWeeklyHours на стороне main), правится вручную построчно.
 */
export function CurriculumWeeksPanel({ curriculumRowId, hoursClassroom }: CurriculumWeeksPanelProps) {
  const [weeks, setWeeks] = useState<CurriculumWeek[] | null>(null)
  const [drafts, setDrafts] = useState<WeekDraft[]>([])
  const [weekCount, setWeekCount] = useState(18)

  const refresh = useCallback(
    () =>
      api.invoke('curriculumWeeks:list', { curriculumRowId }).then((res) => {
        if (res.ok) {
          setWeeks(res.value)
          setDrafts(draftsFromWeeks(res.value))
        } else {
          notifyError(res.error.message)
        }
      }),
    [curriculumRowId],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function generate() {
    const res = await api.invoke('curriculumWeeks:generate', { curriculumRowId, weekCount })
    if (res.ok) {
      setWeeks(res.value)
      setDrafts(draftsFromWeeks(res.value))
      notifySuccess('Раскладка по неделям сгенерирована')
    } else {
      notifyError(res.error.message)
    }
  }

  async function save() {
    const parsed = drafts.map((d) => ({ id: d.id, rowVersion: d.rowVersion, hours: Number(d.hours) }))
    if (parsed.some((d) => !Number.isFinite(d.hours) || d.hours < 0)) {
      notifyError('Часы недели должны быть неотрицательным числом')
      return
    }
    const res = await api.invoke('curriculumWeeks:save', { curriculumRowId, weeks: parsed })
    if (res.ok) {
      setWeeks(res.value)
      setDrafts(draftsFromWeeks(res.value))
      notifySuccess(ruCommon.savedOk)
    } else {
      notifyError(res.error.message)
    }
  }

  const sum = drafts.reduce((acc, d) => acc + (Number(d.hours) || 0), 0)

  return (
    <div className="subpanel">
      <h3>Недельная раскладка часов</h3>
      {weeks === null && <p className="history-empty">Загрузка…</p>}

      {weeks?.length === 0 && (
        <div className="subpanel-add">
          <div className="form-field">
            <label>Число недель</label>
            <input type="number" min={1} value={weekCount} onChange={(e) => setWeekCount(Number(e.target.value))} />
          </div>
          <button type="button" className="btn" onClick={() => void generate()}>
            Сгенерировать равномерно
          </button>
        </div>
      )}

      {weeks != null && weeks.length > 0 && (
        <>
          <table className="bounds-table">
            <thead>
              <tr>
                <th>Неделя</th>
                <th>Часы</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d, idx) => (
                <tr key={d.id}>
                  <td>№{weeks[idx]?.weekNo}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={d.hours}
                      onChange={(e) => setDrafts((prev) => prev.map((p) => (p.id === d.id ? { ...p, hours: e.target.value } : p)))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={sum !== hoursClassroom ? 'overlap-warning' : 'history-empty'}>
            Сумма по неделям: {sum} из {hoursClassroom} аудиторных часов{sum !== hoursClassroom ? ' — не совпадает' : ''}
          </p>
          <div className="btn-group">
            <button type="button" className="btn" onClick={() => void save()}>
              Сохранить раскладку
            </button>
            <button type="button" className="btn" onClick={() => void generate()}>
              Пересоздать равномерно
            </button>
          </div>
        </>
      )}
    </div>
  )
}
