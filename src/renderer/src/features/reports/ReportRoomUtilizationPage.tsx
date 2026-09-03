import type { ColumnDef } from '@tanstack/react-table'
import { useState } from 'react'
import type { RoomUtilizationRow } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { DataTable } from '../../ui/DataTable'
import { notifyError, notifySuccess } from '../../ui/toast'

const columns: ColumnDef<RoomUtilizationRow>[] = [
  { accessorKey: 'roomLabel', header: 'Кабинет' },
  { accessorKey: 'occupiedSlots', header: 'Занято пар' },
  { accessorKey: 'availableSlots', header: 'Доступно пар' },
  {
    id: 'idle',
    header: 'Простой',
    cell: ({ row }) => {
      const pct = Math.round(row.original.idlePercent * 100)
      return <span className={pct > 50 ? 'badge badge-warning' : 'badge'}>{pct}%</span>
    },
  },
]

/** Отчёт «Загрузка кабинетов» (§этап 7): занятость и простой относительно учебных дней и включённых пар. */
export function ReportRoomUtilizationPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [rows, setRows] = useState<RoomUtilizationRow[] | null>(null)

  async function load() {
    const res = await api.invoke('reports:roomUtilization', { dateFrom, dateTo })
    if (res.ok) setRows(res.value)
    else notifyError(res.error.message)
  }

  async function exportExcel() {
    const res = await api.invoke('reports:exportExcel', { report: 'roomUtilization', dateFrom, dateTo })
    if (!res.ok) return notifyError(res.error.message)
    if (!('cancelled' in res.value)) notifySuccess(`Сохранено: ${res.value.path}`)
  }

  async function exportPdf() {
    const res = await api.invoke('reports:exportPdf', { report: 'roomUtilization', dateFrom, dateTo })
    if (!res.ok) return notifyError(res.error.message)
    if (!('cancelled' in res.value)) notifySuccess(`Сохранено: ${res.value.path}`)
  }

  return (
    <div>
      <div className="page-header">
        <h1>Загрузка кабинетов</h1>
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

      {rows == null ? <p className="history-empty">Укажите диапазон дат и нажмите «Показать»</p> : <DataTable columns={columns} data={rows} />}
    </div>
  )
}
