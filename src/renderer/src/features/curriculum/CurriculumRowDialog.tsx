import { useState } from 'react'
import type { Curriculum, CurriculumRow, CurriculumRowEditPreview, Discipline } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Dialog } from '../../ui/Dialog'
import { Select } from '../../ui/Select'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'
import { CurriculumWeeksPanel } from './CurriculumWeeksPanel'

interface CurriculumRowDialogProps {
  curriculum: Curriculum
  row: CurriculumRow | null
  disciplines: Discipline[]
  onClose: () => void
  onSaved: () => void
}

interface FormState {
  disciplineId: number | ''
  course: number
  semesterNo: number
  credits: number
  hoursTotal: number
  hoursClassroom: number
  hoursTheory: number
  hoursPractice: number
  hoursSeminar: number
  hoursLab: number
  hoursSrs: number
  controlSemester: number | ''
  validFrom: string
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function initialState(row: CurriculumRow | null): FormState {
  if (row) {
    return {
      disciplineId: row.disciplineId,
      course: row.course,
      semesterNo: row.semesterNo,
      credits: row.credits,
      hoursTotal: row.hoursTotal,
      hoursClassroom: row.hoursClassroom,
      hoursTheory: row.hoursTheory,
      hoursPractice: row.hoursPractice,
      hoursSeminar: row.hoursSeminar,
      hoursLab: row.hoursLab,
      hoursSrs: row.hoursSrs,
      controlSemester: row.controlSemester ?? '',
      validFrom: row.validFrom,
    }
  }
  return {
    disciplineId: '',
    course: 1,
    semesterNo: 1,
    credits: 0,
    hoursTotal: 0,
    hoursClassroom: 0,
    hoursTheory: 0,
    hoursPractice: 0,
    hoursSeminar: 0,
    hoursLab: 0,
    hoursSrs: 0,
    controlSemester: '',
    validFrom: todayIso(),
  }
}

/**
 * Строка учебного плана (§3.1, §3.2). У утверждённого плана правка версионируется:
 * сначала предпросмотр «затронуто занятий: N после {date}», затем подтверждение,
 * создающее новую строку с supersedesId вместо правки на месте.
 */
export function CurriculumRowDialog({ curriculum, row, disciplines, onClose, onSaved }: CurriculumRowDialogProps) {
  const [form, setForm] = useState<FormState>(() => initialState(row))
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso())
  const [preview, setPreview] = useState<CurriculumRowEditPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isVersionedEdit = row != null && curriculum.status === 'approved'

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setPreview(null)
  }

  function toFields() {
    return {
      disciplineId: form.disciplineId as number,
      course: form.course,
      semesterNo: form.semesterNo,
      credits: form.credits,
      hoursTotal: form.hoursTotal,
      hoursClassroom: form.hoursClassroom,
      hoursTheory: form.hoursTheory,
      hoursPractice: form.hoursPractice,
      hoursSeminar: form.hoursSeminar,
      hoursLab: form.hoursLab,
      hoursSrs: form.hoursSrs,
      controlSemester: form.controlSemester === '' ? null : form.controlSemester,
    }
  }

  const isValid = form.disciplineId !== '' && form.credits > 0

  async function loadPreview() {
    if (!row) return
    setLoading(true)
    const res = await api.invoke('curriculumRows:editPreview', { id: row.id, effectiveFrom })
    setLoading(false)
    if (res.ok) setPreview(res.value)
    else notifyError(res.error.message)
  }

  async function submit() {
    if (!isValid) return
    setLoading(true)
    if (row == null) {
      const res = await api.invoke('curriculumRows:create', { curriculumId: curriculum.id, validFrom: form.validFrom, ...toFields() })
      setLoading(false)
      if (res.ok) {
        notifySuccess(ruCommon.savedOk)
        onSaved()
      } else {
        notifyError(res.error.message)
      }
      return
    }

    const res = await api.invoke('curriculumRows:edit', { id: row.id, rowVersion: row.rowVersion, effectiveFrom, ...toFields() })
    setLoading(false)
    if (res.ok) {
      notifySuccess(res.value.versioned ? `Создана новая версия строки (операция #${res.value.operationId})` : ruCommon.savedOk)
      onSaved()
    } else {
      notifyError(res.error.message)
    }
  }

  async function confirmDeleteRow() {
    if (!row) return
    setConfirmDelete(false)
    const res = await api.invoke('curriculumRows:delete', { id: row.id })
    if (res.ok) {
      notifySuccess(ruCommon.deletedOk)
      onSaved()
    } else {
      notifyError(res.error.message)
    }
  }

  const invariantMismatch = form.credits * 30 !== form.hoursTotal
  const submitLabel = row == null ? ruCommon.create : isVersionedEdit && !preview ? 'Проверить влияние' : ruCommon.save
  const submitAction = isVersionedEdit && !preview ? loadPreview : submit

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()} title={row ? 'Строка учебного плана' : 'Новая строка учебного плана'}>
        <div className="form-field">
          <label htmlFor="row-discipline">Дисциплина</label>
          <Select
            id="row-discipline"
            value={form.disciplineId}
            onChange={(v) => set('disciplineId', v === '' ? '' : Number(v))}
          >
            <option value="">—</option>
            {disciplines.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="form-field">
          <label htmlFor="row-course">Курс</label>
          <input id="row-course" type="number" min={1} max={4} value={form.course} onChange={(e) => set('course', Number(e.target.value))} />
        </div>
        <div className="form-field">
          <label htmlFor="row-semester">Семестр</label>
          <input id="row-semester" type="number" min={1} max={8} value={form.semesterNo} onChange={(e) => set('semesterNo', Number(e.target.value))} />
        </div>
        <div className="form-field">
          <label htmlFor="row-credits">Кредиты</label>
          <input id="row-credits" type="number" min={0} value={form.credits} onChange={(e) => set('credits', Number(e.target.value))} />
        </div>
        <div className="form-field">
          <label htmlFor="row-hours-total">Всего часов {invariantMismatch && <span className="badge badge-warning">кред.×30≠часы</span>}</label>
          <input id="row-hours-total" type="number" min={0} value={form.hoursTotal} onChange={(e) => set('hoursTotal', Number(e.target.value))} />
        </div>
        <div className="form-field">
          <label htmlFor="row-hours-classroom">Аудиторных</label>
          <input id="row-hours-classroom" type="number" min={0} value={form.hoursClassroom} onChange={(e) => set('hoursClassroom', Number(e.target.value))} />
        </div>
        <div className="form-field">
          <label htmlFor="row-hours-theory">Теоретических</label>
          <input id="row-hours-theory" type="number" min={0} value={form.hoursTheory} onChange={(e) => set('hoursTheory', Number(e.target.value))} />
        </div>
        <div className="form-field">
          <label htmlFor="row-hours-practice">Практических</label>
          <input id="row-hours-practice" type="number" min={0} value={form.hoursPractice} onChange={(e) => set('hoursPractice', Number(e.target.value))} />
        </div>
        <div className="form-field">
          <label htmlFor="row-hours-seminar">Семинарских</label>
          <input id="row-hours-seminar" type="number" min={0} value={form.hoursSeminar} onChange={(e) => set('hoursSeminar', Number(e.target.value))} />
        </div>
        <div className="form-field">
          <label htmlFor="row-hours-lab">Лабораторных</label>
          <input id="row-hours-lab" type="number" min={0} value={form.hoursLab} onChange={(e) => set('hoursLab', Number(e.target.value))} />
        </div>
        <div className="form-field">
          <label htmlFor="row-hours-srs">СРС</label>
          <input id="row-hours-srs" type="number" min={0} value={form.hoursSrs} onChange={(e) => set('hoursSrs', Number(e.target.value))} />
        </div>
        <div className="form-field">
          <label htmlFor="row-control">Итоговый контроль — семестр</label>
          <input
            id="row-control"
            type="number"
            min={1}
            value={form.controlSemester}
            onChange={(e) => set('controlSemester', e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>

        {row == null ? (
          <div className="form-field">
            <label htmlFor="row-valid-from">Действует с</label>
            <input id="row-valid-from" type="date" value={form.validFrom} onChange={(e) => setForm((prev) => ({ ...prev, validFrom: e.target.value }))} />
          </div>
        ) : isVersionedEdit ? (
          <div className="form-field">
            <label htmlFor="row-effective">Дата правки (план утверждён — правка создаст новую версию)</label>
            <input
              id="row-effective"
              type="date"
              value={effectiveFrom}
              onChange={(e) => {
                setEffectiveFrom(e.target.value)
                setPreview(null)
              }}
            />
          </div>
        ) : null}

        {preview && (
          <p>
            Затронуто занятий после {effectiveFrom}: <strong>{preview.affectedLessons}</strong>. Сохранение создаст новую версию строки,
            прежняя закроется с {effectiveFrom}.
          </p>
        )}

        <div className="dialog-actions-split">
          <div className="btn-group">
            {row != null && (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                {ruCommon.delete}
              </button>
            )}
          </div>
          <div className="btn-group">
            <button type="button" className="btn" onClick={onClose}>
              {ruCommon.cancel}
            </button>
            <button type="button" className="btn btn-primary" disabled={!isValid || loading} onClick={() => void submitAction()}>
              {submitLabel}
            </button>
          </div>
        </div>

        {row != null && <CurriculumWeeksPanel curriculumRowId={row.id} hoursClassroom={form.hoursClassroom} />}
      </Dialog>

      {confirmDelete && (
        <ConfirmDialog
          open
          title="Удалить строку плана?"
          description={ruCommon.confirmDeleteBody}
          confirmLabel={ruCommon.yesDelete}
          danger
          onConfirm={() => void confirmDeleteRow()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
