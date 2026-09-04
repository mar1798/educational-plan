import { useState } from 'react'
import type { Room, TemplateEntryView } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { Dialog } from '../../ui/Dialog'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'

interface EntryDialogProps {
  entry: TemplateEntryView
  rooms: Room[]
  onClose: () => void
  onChanged: () => void
}

/** Правка занятия шаблона (§4.2, §4.7): кабинет, чётность недели, снятие из шаблона. */
export function EntryDialog({ entry, rooms, onClose, onChanged }: EntryDialogProps) {
  const [roomId, setRoomId] = useState<number | ''>(entry.roomId ?? '')
  const [weekParity, setWeekParity] = useState(entry.weekParity)
  const [saving, setSaving] = useState(false)
  // «Убрать из шаблона» удаляет занятие безвозвратно и одним кликом — рядом с «Сохранить»
  // это слишком легко нажать по ошибке. Подтверждение делается на месте: вложенный
  // модальный диалог поверх этого закрывал бы фокус-ловушку внешнего.
  const [confirmRemove, setConfirmRemove] = useState(false)

  async function save() {
    setSaving(true)
    const res = await api.invoke('scheduleTemplates:moveEntry', {
      id: entry.id,
      rowVersion: entry.rowVersion,
      dayOfWeek: entry.dayOfWeek,
      pairNo: entry.pairNo,
      weekParity,
      roomId: roomId === '' ? null : roomId,
    })
    setSaving(false)
    if (res.ok) {
      notifySuccess(ruCommon.savedOk)
      onChanged()
    } else {
      notifyError(res.error.message)
    }
  }

  async function remove() {
    setSaving(true)
    const res = await api.invoke('scheduleTemplates:removeEntry', { id: entry.id, rowVersion: entry.rowVersion })
    setSaving(false)
    if (res.ok) {
      notifySuccess('Занятие снято из шаблона')
      onChanged()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} title={entry.disciplineName} description={`${entry.teacherName} · ${entry.targetLabel}`}>
      <div className="form-field">
        <label htmlFor="entry-room">Кабинет</label>
        <select id="entry-room" value={roomId} onChange={(e) => setRoomId(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">Не назначен</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.number}
              {r.name ? ` (${r.name})` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor="entry-parity">Чётность недели</label>
        <select id="entry-parity" value={weekParity} onChange={(e) => setWeekParity(e.target.value as TemplateEntryView['weekParity'])}>
          <option value="all">Каждую неделю</option>
          <option value="odd">Через неделю — нечётная</option>
          <option value="even">Через неделю — чётная</option>
        </select>
      </div>
      <div className="dialog-actions-split">
        {confirmRemove ? (
          <div className="btn-group">
            <button type="button" className="btn btn-danger" disabled={saving} onClick={() => void remove()}>
              Да, убрать
            </button>
            <button type="button" className="btn" disabled={saving} onClick={() => setConfirmRemove(false)}>
              {ruCommon.cancel}
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-danger" disabled={saving} onClick={() => setConfirmRemove(true)}>
            Убрать из шаблона
          </button>
        )}
        <div className="btn-group">
          <button type="button" className="btn" onClick={onClose}>
            {ruCommon.cancel}
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {ruCommon.save}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
