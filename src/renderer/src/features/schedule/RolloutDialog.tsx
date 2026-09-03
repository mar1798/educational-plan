import { useState } from 'react'
import type { RolloutPreview } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { Dialog } from '../../ui/Dialog'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'

interface RolloutDialogProps {
  templateId: number
  onClose: () => void
  onApplied: () => void
}

/** Раскатка шаблона на диапазон дат (§4.8–4.10): сначала предпросмотр, применение — отдельным шагом. */
export function RolloutDialog({ templateId, onClose, onApplied }: RolloutDialogProps) {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [preview, setPreview] = useState<RolloutPreview | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)

  async function loadPreview() {
    if (!dateFrom || !dateTo) {
      notifyError('Укажите диапазон дат')
      return
    }
    setBusy(true)
    const res = await api.invoke('scheduleTemplates:rolloutPreview', { templateId, dateFrom, dateTo })
    setBusy(false)
    if (res.ok) setPreview(res.value)
    else notifyError(res.error.message)
  }

  async function apply() {
    setBusy(true)
    const res = await api.invoke('scheduleTemplates:rolloutApply', { templateId, dateFrom, dateTo })
    setBusy(false)
    if (res.ok) {
      notifySuccess(`Добавлено ${res.value.created}, изменено ${res.value.updated}, отменено ${res.value.cancelled}`)
      onApplied()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} title="Раскатка шаблона на даты">
      <div className="form-field">
        <label htmlFor="rollout-from">С даты</label>
        <input id="rollout-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="rollout-to">По дату</label>
        <input id="rollout-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      {!preview ? (
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {ruCommon.cancel}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void loadPreview()}>
            Просмотреть
          </button>
        </div>
      ) : (
        <>
          <p>
            Добавится <strong>{preview.toCreate}</strong>, изменится <strong>{preview.toUpdate}</strong>, отменится{' '}
            <strong>{preview.toCancel}</strong> занятий.
          </p>
          {preview.items.length > 0 && (
            <>
              <button type="button" className="btn-link" onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Скрыть список' : 'Показать список изменений'}
              </button>
              {expanded && (
                <ul className="overlap-list">
                  {preview.items.map((item, i) => (
                    <li key={i}>{item.description}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setPreview(null)}>
              Назад
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void apply()}>
              Применить
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}
