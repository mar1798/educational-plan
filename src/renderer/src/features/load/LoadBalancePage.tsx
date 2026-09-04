import type { ColumnDef } from '@tanstack/react-table'
import { useEffect, useState } from 'react'
import type { GroupBalanceRow, TeacherBalanceRow } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { DataTable } from '../../ui/DataTable'
import { notifyError } from '../../ui/toast'
import { OtherLoadPanel } from './OtherLoadPanel'
import { useSemesterOptions } from './useSemesterOptions'
import { FilterSelect } from '../../ui/FilterSelect'
import { useInitialSelection } from '../../ui/useInitialSelection'

const groupColumns: ColumnDef<GroupBalanceRow>[] = [
  { accessorKey: 'groupName', header: 'Группа' },
  { accessorKey: 'plannedHours', header: 'По плану, ч' },
  { accessorKey: 'assignedHours', header: 'Роздано, ч' },
  {
    // Отрицательный остаток — это не «не роздано минус столько-то», а перебор над планом:
    // раздали больше, чем стоит в учебном плане. Подписью и знаком показываем именно это,
    // иначе строка «Не роздано −648» читается как ошибка расчёта.
    id: 'remaining',
    header: 'Остаток плана, ч',
    cell: ({ row }) => {
      const remaining = row.original.remainingHours
      if (remaining === 0) return <span className="badge">роздано полностью</span>
      return (
        <span className="badge badge-warning">
          {remaining > 0 ? `не роздано ${remaining}` : `перероздано ${-remaining}`}
        </span>
      )
    },
  },
  {
    // §3.7a: недельный лимит виден до генерации расписания, а не только в момент,
    // когда очередная строка нагрузки его уже нарушила.
    id: 'limit',
    header: 'Лимит за семестр, ч',
    cell: ({ row }) => (
      <span className={row.original.assignedHours > row.original.limitHours * 0.95 ? 'badge badge-warning' : 'badge'}>
        {row.original.limitHours} ({row.original.maxHoursPerWeek} ч/нед.)
      </span>
    ),
  },
]

const teacherColumns: ColumnDef<TeacherBalanceRow>[] = [
  { accessorKey: 'teacherName', header: 'Преподаватель' },
  { accessorKey: 'assignedHours', header: 'Нагрузка, ч' },
  { accessorKey: 'otherHours', header: 'Прочие часы, ч' },
  { accessorKey: 'totalHours', header: 'Всего, ч' },
  { id: 'norm', header: 'Норма в год', cell: ({ row }) => row.original.normHoursYear ?? '—' },
  {
    id: 'overNorm',
    header: '',
    cell: ({ row }) => (row.original.overNorm ? <span className="badge badge-warning">сверх нормы</span> : null),
  },
]

/**
 * Баланс нагрузки (§3.7): по группам — сколько часов плана ещё не роздано;
 * по преподавателям — сколько набрано против годовой нормы (только у штатных, §1.1 п.39).
 */
export function LoadBalancePage() {
  const { semesters, label: semesterLabel } = useSemesterOptions()
  const [semesterId, setSemesterId] = useState<number | ''>('')
  const [byGroup, setByGroup] = useState<GroupBalanceRow[]>([])
  const [byTeacher, setByTeacher] = useState<TeacherBalanceRow[]>([])

  // Пока завуч явно не выбрал семестр, подставляем первый из списка — но ровно один раз,
  // на его приезд: пока это считалось на каждый рендер, пустой пункт фильтра выбрать было
  // нельзя, значение тут же возвращалось к первому семестру.
  useInitialSelection(semesters, semesterId !== '', (list) => setSemesterId(list[0]!.id))
  const selectedSemesterId = semesterId

  useEffect(() => {
    if (selectedSemesterId === '') return
    void api.invoke('loadBalance:byGroup', { semesterId: selectedSemesterId }).then((res) => {
      if (res.ok) setByGroup(res.value)
      else notifyError(res.error.message)
    })
    void api.invoke('loadBalance:byTeacher', { semesterId: selectedSemesterId }).then((res) => {
      if (res.ok) setByTeacher(res.value)
      else notifyError(res.error.message)
    })
  }, [selectedSemesterId])

  return (
    <div>
      <div className="page-header">
        <h1>Баланс нагрузки</h1>
        <div className="toolbar-actions">
          <FilterSelect
            label="Семестр"
            hint="Семестр, за который считается баланс часов"
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
        </div>
      </div>

      {selectedSemesterId === '' ? (
        <p className="history-empty">Выберите семестр</p>
      ) : (
        <>
          <h3>По группам</h3>
          <DataTable columns={groupColumns} data={byGroup} />

          <h3>По преподавателям</h3>
          <DataTable columns={teacherColumns} data={byTeacher} />

          <OtherLoadPanel semesterId={selectedSemesterId} />
        </>
      )}
    </div>
  )
}
