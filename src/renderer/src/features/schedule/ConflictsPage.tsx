import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ScheduleConflictView } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { DataTable } from '../../ui/DataTable'
import { notifyError } from '../../ui/toast'

/** Экран конфликтов на диапазон дат (§5.8, задача 4.11) — сканирует уже материализованные занятия. */
export function ConflictsPage() {
  const navigate = useNavigate()
  const today = new Date().toISOString().slice(0, 10)
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [conflicts, setConflicts] = useState<ScheduleConflictView[] | null>(null)

  // «С переходом к занятию» (задача 4.11): открываем шаблон нужной версии в разрезе
  // группы и в режиме одного дня — того самого слота, где конфликт.
  const columns = useMemo<ColumnDef<ScheduleConflictView>[]>(
    () => [
      { accessorKey: 'date', header: 'Дата' },
      { accessorKey: 'pairNo', header: 'Пара' },
      { accessorKey: 'description', header: 'Конфликт' },
      {
        id: 'goto',
        header: '',
        cell: ({ row }) => {
          const c = row.original
          if (c.templateId == null) return <span className="history-empty">вне шаблона</span>
          const params = new URLSearchParams({ template: String(c.templateId), day: String(c.dayOfWeek) })
          if (c.semesterId != null) params.set('semester', String(c.semesterId))
          if (c.groupId != null) params.set('group', String(c.groupId))
          return (
            <button type="button" className="btn-link" onClick={() => navigate(`/schedule-template?${params.toString()}`)}>
              Перейти к занятию
            </button>
          )
        },
      },
    ],
    [navigate],
  )

  async function load() {
    const res = await api.invoke('schedule:conflicts', { dateFrom, dateTo })
    if (res.ok) setConflicts(res.value)
    else notifyError(res.error.message)
  }

  return (
    <div>
      <div className="page-header">
        <h1>Конфликты в расписании</h1>
        <div className="toolbar-actions">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <button type="button" className="btn btn-primary" onClick={() => void load()}>
            Найти конфликты
          </button>
        </div>
      </div>

      {conflicts == null ? (
        <p className="history-empty">Укажите диапазон дат и нажмите «Найти конфликты»</p>
      ) : conflicts.length === 0 ? (
        <p className="history-empty">Конфликтов не найдено</p>
      ) : (
        <DataTable columns={columns} data={conflicts} />
      )}
    </div>
  )
}
