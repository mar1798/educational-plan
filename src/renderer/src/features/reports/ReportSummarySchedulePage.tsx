import { useEffect, useState } from 'react'
import type { ScheduleTemplate } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { notifyError, notifySuccess } from '../../ui/toast'
import { useSemesterOptions } from '../load/useSemesterOptions'
import { FilterSelect } from '../../ui/FilterSelect'
import { useInitialSelection } from '../../ui/useInitialSelection'

/** Отчёт «Сводное расписание колледжа» (§этап 7): тонкая обёртка над уже готовыми export:excel/export:pdf. */
export function ReportSummarySchedulePage() {
  const { semesters, label: semesterLabel } = useSemesterOptions()
  const [semesterId, setSemesterId] = useState<number | ''>('')
  useInitialSelection(semesters, semesterId !== '', (list) => setSemesterId(list[0]!.id))
  const selectedSemesterId = semesterId

  const [templates, setTemplates] = useState<ScheduleTemplate[]>([])
  const [templateId, setTemplateId] = useState<number | ''>('')

  useEffect(() => {
    if (selectedSemesterId === '') return
    void api.invoke('scheduleTemplates:list', { semesterId: selectedSemesterId }).then((res) => {
      if (!res.ok) return
      setTemplates(res.value)
      // Подстановка версии — только при смене семестра: прежняя принадлежала другому
      // семестру. Внутри одного семестра выбор (включая пустой) остаётся за пользователем.
      setTemplateId((current) =>
        current !== '' && res.value.some((t) => t.id === current) ? current : ((res.value.find((t) => t.status === 'active') ?? res.value[0])?.id ?? ''),
      )
    })
  }, [selectedSemesterId])

  const selectedTemplateId = templateId

  async function exportExcel() {
    if (selectedTemplateId === '') return notifyError('Выберите версию шаблона')
    const res = await api.invoke('export:excel', { templateId: selectedTemplateId, kind: 'summary' })
    if (!res.ok) return notifyError(res.error.message)
    if (!('cancelled' in res.value)) notifySuccess(`Сохранено: ${res.value.path}`)
  }

  async function exportPdf() {
    if (selectedTemplateId === '') return notifyError('Выберите версию шаблона')
    const res = await api.invoke('export:pdf', { templateId: selectedTemplateId })
    if (!res.ok) return notifyError(res.error.message)
    if (!('cancelled' in res.value)) notifySuccess(`Сохранено: ${res.value.path}`)
  }

  return (
    <div>
      <div className="page-header">
        <h1>Сводное расписание колледжа</h1>
        <div className="toolbar-actions">
          <FilterSelect
            label="Семестр"
            hint="Семестр, чьи версии шаблона доступны для выгрузки"
            value={selectedSemesterId}
            onChange={(v) => setSemesterId(v === '' ? '' : Number(v))}
          >
            <option value="">Выберите семестр</option>
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {semesterLabel(s.id)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Версия"
            hint="Версия шаблона недели, которая пойдёт в выгрузку"
            value={selectedTemplateId}
            onChange={(v) => setTemplateId(v === '' ? '' : Number(v))}
          >
            <option value="">Версия шаблона…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                v{t.versionNo} {t.status === 'active' ? '(активна)' : ''} — с {t.effectiveFrom}
              </option>
            ))}
          </FilterSelect>
          <button type="button" className="btn" onClick={() => void exportExcel()}>
            Экспорт в Excel (по группам)
          </button>
          <button type="button" className="btn" onClick={() => void exportPdf()}>
            Печать PDF (по группам)
          </button>
        </div>
      </div>

      <p className="history-empty">
        Экспорт формирует по листу/странице на каждую группу, занятую в выбранной версии шаблона недели.
      </p>
    </div>
  )
}
