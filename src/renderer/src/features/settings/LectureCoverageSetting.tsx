import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'

// Ключ тот же, что читает main/services/lecture-coverage.ts.
const KEY = 'lecture_coverage_before_practice'

/** Порог правила «практика после лекций» (§этап Г): сколько процентов лекций должно быть пройдено к началу практики. */
export function LectureCoverageSetting() {
  const [value, setValue] = useState('80')

  useEffect(() => {
    void api.invoke('settings:get', { key: KEY }).then((r) => r.ok && r.value.value != null && setValue(r.value.value))
  }, [])

  async function save() {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0 || n > 100) return notifyError('Порог — число от 1 до 100')
    const res = await api.invoke('settings:set', { key: KEY, value: String(n) })
    if (res.ok) notifySuccess(ruCommon.savedOk)
    else notifyError(res.error.message)
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h2>Практика после лекций</h2>
      <p className="history-empty">Программа предупреждает, если к началу практики пройдено меньше этой доли теории. Это рекомендация, генерацию она не блокирует.</p>
      <div className="form-field">
        <label htmlFor="lecture-coverage">Порог, %</label>
        <input id="lecture-coverage" type="number" min={1} max={100} value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <button type="button" className="btn btn-primary" onClick={() => void save()}>
        {ruCommon.save}
      </button>
    </div>
  )
}
