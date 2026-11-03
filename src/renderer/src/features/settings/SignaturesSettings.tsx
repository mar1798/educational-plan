import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'

// Ключи те же, что читает main/export/college-schedule.ts.
const KEYS = { director: 'schedule_director_name', deputy: 'schedule_deputy_name' } as const

/** ФИО для подписей под сводным расписанием (§этап Б); пустое поле — печатается только должность и линия. */
export function SignaturesSettings() {
  const [director, setDirector] = useState('')
  const [deputy, setDeputy] = useState('')

  useEffect(() => {
    void api.invoke('settings:get', { key: KEYS.director }).then((r) => r.ok && setDirector(r.value.value ?? ''))
    void api.invoke('settings:get', { key: KEYS.deputy }).then((r) => r.ok && setDeputy(r.value.value ?? ''))
  }, [])

  async function save() {
    const results = await Promise.all([
      api.invoke('settings:set', { key: KEYS.director, value: director.trim() }),
      api.invoke('settings:set', { key: KEYS.deputy, value: deputy.trim() }),
    ])
    const failed = results.find((r) => !r.ok)
    if (failed && !failed.ok) return notifyError(failed.error.message)
    notifySuccess(ruCommon.savedOk)
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h2>Подписи в расписании</h2>
      <p className="history-empty">Печатаются под «Утверждаю» и «Согласовано» в выгрузке сводного расписания. Пустое поле — только должность и линия для подписи.</p>
      <div className="form-field">
        <label htmlFor="sig-director">Директор (ФИО)</label>
        <input id="sig-director" value={director} onChange={(e) => setDirector(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="sig-deputy">Зам. директора (ФИО)</label>
        <input id="sig-deputy" value={deputy} onChange={(e) => setDeputy(e.target.value)} />
      </div>
      <button type="button" className="btn btn-primary" onClick={() => void save()}>
        {ruCommon.save}
      </button>
    </div>
  )
}
