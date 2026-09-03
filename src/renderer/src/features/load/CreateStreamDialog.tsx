import { useState } from 'react'
import type { StudyGroup } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { Dialog } from '../../ui/Dialog'
import { ruCommon } from '../../ui/locale'
import { notifyError } from '../../ui/toast'

interface CreateStreamDialogProps {
  semesterId: number
  groups: StudyGroup[]
  onClose: () => void
  onCreated: () => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Создание потока (§3.5a): группы одной специальности и курса — проверяется на стороне main. */
export function CreateStreamDialog({ semesterId, groups, onClose, onCreated }: CreateStreamDialogProps) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [validFrom, setValidFrom] = useState(todayIso())
  const [loading, setLoading] = useState(false)

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit() {
    setLoading(true)
    const res = await api.invoke('streams:create', { semesterId, name, groupIds: [...selected], validFrom })
    setLoading(false)
    if (res.ok) onCreated()
    else notifyError(res.error.message)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Создать поток">
      <div className="form-field">
        <label htmlFor="stream-name">Название потока</label>
        <input id="stream-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Хирургия — поток СД-2" />
      </div>
      <div className="form-field">
        <label htmlFor="stream-valid-from">Действует с</label>
        <input id="stream-valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
      </div>
      <div className="form-field">
        <label>Группы (одной специальности и курса)</label>
        <div className="subpanel">
          {groups.map((g) => (
            <div className="form-field-checkbox" key={g.id}>
              <input id={`stream-group-${g.id}`} type="checkbox" checked={selected.has(g.id)} onChange={() => toggle(g.id)} />
              <label htmlFor={`stream-group-${g.id}`}>{g.name}</label>
            </div>
          ))}
        </div>
      </div>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          {ruCommon.cancel}
        </button>
        <button className="btn btn-primary" disabled={loading || name.trim() === '' || selected.size < 2} onClick={() => void submit()}>
          Создать
        </button>
      </div>
    </Dialog>
  )
}
