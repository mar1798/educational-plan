import type { ColumnDef } from '@tanstack/react-table'
import { useEffect, useState } from 'react'
import type { TeacherLoadReportRow } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { DataTable } from '../../ui/DataTable'
import { notifyError, notifySuccess } from '../../ui/toast'
import { useSemesterOptions } from '../load/useSemesterOptions'
import { FilterSelect } from '../../ui/FilterSelect'
import { useInitialSelection } from '../../ui/useInitialSelection'

const columns: ColumnDef<TeacherLoadReportRow>[] = [
  { accessorKey: 'teacherName', header: 'Преподаватель' },
  { accessorKey: 'categoryTitle', header: 'Категория' },
  { accessorKey: 'planHours', header: 'План, ч' },
  { accessorKey: 'factHours', header: 'Факт, ч' },
  { accessorKey: 'otherHours', header: 'Прочие часы, ч' },
  { accessorKey: 'totalHours', header: 'Итого, ч' },
  { id: 'norm', header: 'Норма, ч', cell: ({ row }) => row.original.normHoursYear ?? '—' },
  {
    id: 'shortfall',
    header: 'Недоработка, ч',
    cell: ({ row }) =>
      row.original.shortfallHours == null ? (
        '—'
      ) : (
        <span className={row.original.shortfallHours > 0 ? 'badge badge-warning' : 'badge'}>{row.original.shortfallHours}</span>
      ),
  },
]

/** Отчёт «Выполнение нагрузки» (§этап 7, §1.1 п.22/25/36/39): план/факт за учебный год, недоработка только у штатных. */
export function ReportTeacherLoadPage() {
  const { academicYears } = useSemesterOptions()
  const [academicYearId, setAcademicYearId] = useState<number | ''>('')
  const [rows, setRows] = useState<TeacherLoadReportRow[]>([])

  useInitialSelection(academicYears, academicYearId !== '', (list) => setAcademicYearId(list[0]!.id))
  const selectedYearId = academicYearId

  useEffect(() => {
    if (selectedYearId === '') return
    void api.invoke('reports:teacherLoad', { academicYearId: selectedYearId }).then((res) => {
      if (res.ok) setRows(res.value)
      else notifyError(res.error.message)
    })
  }, [selectedYearId])

  async function exportExcel() {
    if (selectedYearId === '') return
    const res = await api.invoke('reports:exportExcel', { report: 'teacherLoad', academicYearId: selectedYearId })
    if (!res.ok) return notifyError(res.error.message)
    if (!('cancelled' in res.value)) notifySuccess(`Сохранено: ${res.value.path}`)
  }

  async function exportPdf() {
    if (selectedYearId === '') return
    const res = await api.invoke('reports:exportPdf', { report: 'teacherLoad', academicYearId: selectedYearId })
    if (!res.ok) return notifyError(res.error.message)
    if (!('cancelled' in res.value)) notifySuccess(`Сохранено: ${res.value.path}`)
  }

  return (
    <div>
      <div className="page-header">
        <h1>Выполнение нагрузки</h1>
        <div className="toolbar-actions">
          <FilterSelect
            label="Учебный год"
            hint="Год, за который считается годовая нагрузка преподавателей"
            value={selectedYearId}
            onChange={(v) => setAcademicYearId(v === '' ? '' : Number(v))}
          >
            <option value="">Выберите учебный год</option>
            {academicYears.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </FilterSelect>
          <button type="button" className="btn" onClick={() => void exportExcel()}>
            Экспорт в Excel
          </button>
          <button type="button" className="btn" onClick={() => void exportPdf()}>
            Печать PDF
          </button>
        </div>
      </div>

      {selectedYearId === '' ? <p className="history-empty">Выберите учебный год</p> : <DataTable columns={columns} data={rows} />}
    </div>
  )
}
