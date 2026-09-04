import { useState } from 'react'
import type { GroupMergePreview, StudyGroup } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { Dialog } from '../../ui/Dialog'
import { Select } from '../../ui/Select'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'

interface MergeGroupsDialogProps {
  groups: StudyGroup[]
  onClose: () => void
  onMerged: () => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Объединение групп (§2.4): предпросмотр (сколько активной нагрузки/строк потока
 * будет перенесено с поглощённой группы на целевую) → подтверждение → операция
 * `bulk_edit` с откатом через общий `operations:undo` (§1.5).
 */
export function MergeGroupsDialog({ groups, onClose, onMerged }: MergeGroupsDialogProps) {
  const [sourceGroupId, setSourceGroupId] = useState<number | ''>('')
  const [targetGroupId, setTargetGroupId] = useState<number | ''>('')
  const [mergeDate, setMergeDate] = useState(todayIso())
  const [preview, setPreview] = useState<GroupMergePreview | null>(null)
  const [loading, setLoading] = useState(false)

  function resetPreview() {
    setPreview(null)
  }

  async function loadPreview() {
    if (sourceGroupId === '' || targetGroupId === '') return
    setLoading(true)
    const res = await api.invoke('groups:mergePreview', { sourceGroupId, targetGroupId, mergeDate })
    setLoading(false)
    if (res.ok) setPreview(res.value)
    else {
      notifyError(res.error.message)
      setPreview(null)
    }
  }

  async function confirmMerge() {
    if (sourceGroupId === '' || targetGroupId === '') return
    setLoading(true)
    const res = await api.invoke('groups:merge', { sourceGroupId, targetGroupId, mergeDate })
    setLoading(false)
    if (res.ok) {
      notifySuccess(`Группы объединены (операция #${res.value.operationId}) — отменить можно в разделе «Операции»`)
      onMerged()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Объединить группы">
      <div className="form-field">
        <label htmlFor="merge-source">Поглощаемая группа</label>
        <Select
          id="merge-source"
          value={sourceGroupId}
          onChange={(v) => {
            setSourceGroupId(v === '' ? '' : Number(v))
            resetPreview()
          }}
        >
          <option value="">—</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id} disabled={g.id === targetGroupId}>
              {g.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="form-field">
        <label htmlFor="merge-target">Целевая группа</label>
        <Select
          id="merge-target"
          value={targetGroupId}
          onChange={(v) => {
            setTargetGroupId(v === '' ? '' : Number(v))
            resetPreview()
          }}
        >
          <option value="">—</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id} disabled={g.id === sourceGroupId}>
              {g.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="form-field">
        <label htmlFor="merge-date">Дата объединения</label>
        <input
          id="merge-date"
          type="date"
          value={mergeDate}
          onChange={(e) => {
            setMergeDate(e.target.value)
            resetPreview()
          }}
        />
      </div>

      {preview && (
        <p>
          «{preview.sourceGroupName}» будет закрыта с {mergeDate} и объединена в «{preview.targetGroupName}». Будет перенесено:{' '}
          {preview.affectedTeachingLoad} строк нагрузки, {preview.affectedStreamMembers} записей потоков.
        </p>
      )}

      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          {ruCommon.cancel}
        </button>
        {!preview ? (
          <button className="btn btn-primary" disabled={sourceGroupId === '' || targetGroupId === '' || loading} onClick={() => void loadPreview()}>
            Посмотреть
          </button>
        ) : (
          <button className="btn btn-primary" disabled={loading} onClick={() => void confirmMerge()}>
            Объединить
          </button>
        )}
      </div>
    </Dialog>
  )
}
