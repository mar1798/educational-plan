import type { ColumnDef } from '@tanstack/react-table'
import { useState } from 'react'
import type { DeductedHoursRow } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { DataTable } from '../../ui/DataTable'
import { notifyError, notifySuccess } from '../../ui/toast'

const columns: ColumnDef<DeductedHoursRow>[] = [
  { accessorKey: 'disciplineName', header: 'Дисциплина' },
  { accessorKey: 'groupName', header: 'Группа' },
  { accessorKey: 'cancelledCount', header: 'Отменено занятий' },
  { accessorKey: 'cancelledHours', header: 'Вычтено часов' },
]

/** Отчёт «Вычтенные часы» (§этап 7): сколько часов плана потеряно из-за отмен занятий за период. */
export function ReportDeductedHoursPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [rows, setRows] = useState<DeductedHoursRow[] | null>(null)

  async function load() {
    const res = await api.invoke('reports:deductedHours', { dateFrom, dateTo })
    if (res.ok) setRows(res.value)
    else notifyError(res.error.message)
  }

  async function exportExcel() {
    const res = await api.invoke('reports:exportExcel', { report: 'deductedHours', dateFrom, dateTo })
    if (!res.ok) return notifyError(res.error.message)
    if (!('cancelled' in res.value)) notifySuccess(`Сохранено: ${res.value.path}`)
  }

  async function exportPdf() {
    const res = await api.invoke('reports:exportPdf', { report: 'deductedHours', dateFrom, dateTo })
    if (!res.ok) return notifyError(res.error.message)
    if (!('cancelled' in res.value)) notifySuccess(`Сохранено: ${res.value.path}`)
  }

  return (
    <div>
      <div className="page-header">
        <h1>Вычтенные часы</h1>
        <div className="toolbar-actions">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <button type="button" className="btn btn-primary" onClick={() => void load()}>
            Показать
          </button>
          <button type="button" className="btn" onClick={() => void exportExcel()}>
            Экспорт в Excel
          </button>
          <button type="button" className="btn" onClick={() => void exportPdf()}>
            Печать PDF
          </button>
        </div>
      </div>

      {rows == null ? (
        <p className="history-empty">Укажите диапазон дат и нажмите «Показать»</p>
      ) : rows.length === 0 ? (
        <p className="history-empty">За этот период отмен не было</p>
      ) : (
        <DataTable columns={columns} data={rows} />
      )}
    </div>
  )
}
