import { useState } from 'react'
import { api } from '../../api/client'
import { Dialog } from '../../ui/Dialog'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'

interface NewVersionDialogProps {
  semesterId: number
  currentTemplateId: number | null
  onClose: () => void
  onCreated: (templateId: number) => void
}

/** Новая версия шаблона (§4.1): опционально копирует записи текущей версии, дальше правится вручную. */
export function NewVersionDialog({ semesterId, currentTemplateId, onClose, onCreated }: NewVersionDialogProps) {
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [note, setNote] = useState('')
  const [copyCurrent, setCopyCurrent] = useState(currentTemplateId != null)
  const [saving, setSaving] = useState(false)

  async function create() {
    if (!effectiveFrom) {
      notifyError('Укажите дату вступления в силу')
      return
    }
    setSaving(true)
    const res = await api.invoke('scheduleTemplates:create', {
      semesterId,
      effectiveFrom,
      note: note || null,
      copyFromTemplateId: copyCurrent ? currentTemplateId : null,
    })
    setSaving(false)
    if (res.ok) {
      notifySuccess('Версия шаблона создана')
      onCreated(res.value.id)
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} title="Новая версия шаблона">
      <div className="form-field">
        <label htmlFor="version-from">Дата вступления в силу</label>
        <input id="version-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="version-note">Заметка</label>
        <input id="version-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {currentTemplateId != null && (
        <div className="form-field-checkbox">
          <input id="version-copy" type="checkbox" checked={copyCurrent} onChange={(e) => setCopyCurrent(e.target.checked)} />
          <label htmlFor="version-copy">Скопировать записи текущей версии</label>
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          {ruCommon.cancel}
        </button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void create()}>
          {ruCommon.create}
        </button>
      </div>
    </Dialog>
  )
}
