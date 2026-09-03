import { useState } from 'react'
import type { Cell } from '../../../../shared/import/engine'
import { api } from '../../api/client'
import { Dialog } from '../../ui/Dialog'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess, notifyWarning } from '../../ui/toast'

interface PasteCurriculumRowsDialogProps {
  curriculumId: number
  onClose: () => void
  onDone: () => void
}

const COLUMNS = [
  'disciplineName',
  'course',
  'semesterNo',
  'credits',
  'hoursTotal',
  'hoursClassroom',
  'hoursTheory',
  'hoursPractice',
  'hoursSeminar',
  'hoursLab',
  'hoursSrs',
  'controlSemester',
] as const

const COLUMN_LABEL = [
  'Дисциплина',
  'Курс',
  'Семестр',
  'Кредиты',
  'Всего часов',
  'Аудиторных',
  'Теор.',
  'Практ.',
  'Семин.',
  'Лаб.',
  'СРС',
  'Итог. контроль',
]

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function parseTsv(text: string): Record<string, Cell>[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const cells = line.split('\t')
      return Object.fromEntries(
        COLUMNS.map((field, i) => {
          const raw = (cells[i] ?? '').trim()
          if (raw === '') return [field, null]
          const num = Number(raw.replace(',', '.'))
          return [field, field === 'disciplineName' || Number.isNaN(num) ? raw : num]
        }),
      )
    })
}

/**
 * Быстрый ручной ввод (§3.10): вставка диапазона из буфера — то же сопоставление
 * колонок и та же логика резолвинга дисциплин, что в мастере импорта (import/apply.ts),
 * но без пяти шагов — колонки фиксированы, вставляется готовый TSV-диапазон из Excel.
 */
export function PasteCurriculumRowsDialog({ curriculumId, onClose, onDone }: PasteCurriculumRowsDialogProps) {
  const [text, setText] = useState('')
  const [validFrom, setValidFrom] = useState(todayIso())
  const [loading, setLoading] = useState(false)

  const rows = parseTsv(text)

  async function submit() {
    if (rows.length === 0) return
    setLoading(true)
    const res = await api.invoke('curriculumRows:bulkCreate', { curriculumId, rows, validFrom })
    setLoading(false)
    if (res.ok) {
      notifySuccess(`Создано строк: ${res.value.created} (операция #${res.value.operationId})`)
      if (res.value.skipped.length > 0) {
        notifyWarning(`Пропущено: ${res.value.skipped.length} — ${res.value.skipped[0]!.reason}`)
      }
      onDone()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Вставить строки из буфера">
      <p className="history-empty">
        Скопируйте диапазон из Excel (Tab между колонками, Enter между строками) в порядке: {COLUMN_LABEL.join(' → ')}. Дисциплина должна
        уже существовать в справочнике — так же, как при импорте.
      </p>
      <div className="form-field">
        <label htmlFor="paste-textarea">Вставленный диапазон</label>
        <textarea
          id="paste-textarea"
          rows={10}
          style={{ width: '100%', fontFamily: 'monospace' }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Анатомия\t1\t1\t4\t120\t80\t40\t20\t10\t10\t30\t1'}
        />
      </div>
      <div className="form-field">
        <label htmlFor="paste-valid-from">Действует с</label>
        <input id="paste-valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
      </div>
      <p className="history-empty">Распознано строк: {rows.length}</p>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          {ruCommon.cancel}
        </button>
        <button className="btn btn-primary" disabled={rows.length === 0 || loading} onClick={() => void submit()}>
          Добавить
        </button>
      </div>
    </Dialog>
  )
}
