import { useState } from 'react'
import type { Curriculum, Speciality } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { Dialog } from '../../ui/Dialog'
import { ruCommon } from '../../ui/locale'
import { Select } from '../../ui/Select'

interface CopyCurriculumDialogProps {
  source: Curriculum
  specialities: Speciality[]
  onClose: () => void
  onCopied: (operationId: number) => void
  onError: (message: string) => void
}

/**
 * Копирование плана на новый набор (§3.3) — быстрый ручной ввод (§3.10): специальность
 * копии не обязана совпадать с исходной, план одной специальности можно использовать
 * как заготовку для другой («шаблоны специальностей»).
 */
export function CopyCurriculumDialog({ source, specialities, onClose, onCopied, onError }: CopyCurriculumDialogProps) {
  const [specialityId, setSpecialityId] = useState(source.specialityId)
  const [admissionYear, setAdmissionYear] = useState(source.admissionYear + 1)
  const [name, setName] = useState(`${source.name} (копия)`)
  const [loading, setLoading] = useState(false)

  async function confirm() {
    setLoading(true)
    const res = await api.invoke('curricula:copy', { fromCurriculumId: source.id, specialityId, admissionYear, name })
    setLoading(false)
    if (res.ok) onCopied(res.value.operationId)
    else onError(res.error.message)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={`Копировать план «${source.name}»`}>
      <div className="form-field">
        <label htmlFor="copy-speciality">Специальность копии</label>
        <Select id="copy-speciality" value={specialityId} onChange={(v) => setSpecialityId(Number(v))}>
          {specialities.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="form-field">
        <label htmlFor="copy-year">Год набора</label>
        <input id="copy-year" type="number" value={admissionYear} onChange={(e) => setAdmissionYear(Number(e.target.value))} />
      </div>
      <div className="form-field">
        <label htmlFor="copy-name">Название нового плана</label>
        <input id="copy-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <p className="history-empty">Строки плана переносятся все; недельная раскладка часов — нет, она задаётся заново для нового семестра.</p>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          {ruCommon.cancel}
        </button>
        <button className="btn btn-primary" disabled={loading || name.trim() === ''} onClick={() => void confirm()}>
          Копировать
        </button>
      </div>
    </Dialog>
  )
}
