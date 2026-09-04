import type { ColumnDef } from '@tanstack/react-table'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CurriculumRow, Discipline, StudyGroup, Teacher, TeachingLoad } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { DataTable } from '../../ui/DataTable'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'
import { TeachingLoadDialog } from './TeachingLoadDialog'
import { useSemesterOptions } from './useSemesterOptions'
import { FilterSelect } from '../../ui/FilterSelect'
import { useInitialSelection } from '../../ui/useInitialSelection'

const KIND_LABEL: Record<TeachingLoad['lessonKind'], string> = {
  theory: 'Теория',
  practice: 'Практика',
  seminar: 'Семинар',
  lab: 'Лаборатория',
}

/**
 * Редактор нагрузки (§3.5, §3.6, §3.6a): назначение преподавателя на «дисциплина +
 * группа/подгруппа/поток + вид занятия». Разбит по семестрам — нагрузка вводится
 * отдельно на каждый семестр (учебный год делится на два семестра, §1.1 п.38).
 */
export function LoadEditorPage() {
  const { semesters, label: semesterLabel } = useSemesterOptions()
  const [semesterId, setSemesterId] = useState<number | ''>('')
  const [rows, setRows] = useState<TeachingLoad[] | null>(null)
  const [groups, setGroups] = useState<StudyGroup[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [disciplines, setDisciplines] = useState<Discipline[]>([])
  const [curriculumRows, setCurriculumRows] = useState<CurriculumRow[]>([])
  const [editingRow, setEditingRow] = useState<TeachingLoad | 'new' | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TeachingLoad | null>(null)

  // Пока завуч явно не выбрал семестр, подставляем первый из списка — но ровно один раз,
  // на его приезд: пока это считалось на каждый рендер, пустой пункт фильтра выбрать было
  // нельзя, значение тут же возвращалось к первому семестру.
  useInitialSelection(semesters, semesterId !== '', (list) => setSemesterId(list[0]!.id))
  const selectedSemesterId = semesterId

  useEffect(() => {
    void api.invoke('groups:list', {}).then((res) => res.ok && setGroups(res.value))
    void api.invoke('teachers:list', {}).then((res) => res.ok && setTeachers(res.value))
    void api.invoke('disciplines:list', { includeArchived: true }).then((res) => res.ok && setDisciplines(res.value))
  }, [])

  useEffect(() => {
    void api.invoke('curricula:list', { includeArchived: true }).then(async (res) => {
      if (!res.ok) return
      const all = await Promise.all(res.value.map((c) => api.invoke('curriculumRows:list', { curriculumId: c.id })))
      setCurriculumRows(all.filter((r) => r.ok).flatMap((r) => (r.ok ? r.value : [])))
    })
  }, [])

  const refresh = useCallback(() => {
    if (selectedSemesterId === '') return Promise.resolve()
    return api.invoke('teachingLoad:list', { semesterId: selectedSemesterId }).then((res) => {
      if (res.ok) setRows(res.value)
      else notifyError(res.error.message)
    })
  }, [selectedSemesterId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const disciplineById = useMemo(() => new Map(disciplines.map((d) => [d.id, d])), [disciplines])
  const curriculumRowById = useMemo(() => new Map(curriculumRows.map((r) => [r.id, r])), [curriculumRows])

  const disciplineName = (row: TeachingLoad) => {
    const r = curriculumRowById.get(row.curriculumRowId)
    if (!r) return `строка плана #${row.curriculumRowId}`
    return disciplineById.get(r.disciplineId)?.name ?? `дисциплина #${r.disciplineId}`
  }

  const columns: ColumnDef<TeachingLoad>[] = [
    { id: 'teacher', header: 'Преподаватель', accessorFn: (r) => { const t = teacherById.get(r.teacherId); return t ? `${t.lastName} ${t.firstName}` : `#${r.teacherId}` } },
    { id: 'discipline', header: 'Дисциплина', accessorFn: disciplineName },
    { id: 'target', header: 'Группа/поток', accessorFn: (r) => (r.groupId != null ? groupById.get(r.groupId)?.name ?? `гр. #${r.groupId}` : `поток #${r.streamId}`) },
    { id: 'kind', header: 'Вид', accessorFn: (r) => KIND_LABEL[r.lessonKind] },
    { accessorKey: 'hoursPlanned', header: 'Часы' },
    { id: 'parallel', header: '', cell: ({ row }) => (row.original.requiresParallel ? <span className="badge">парал.</span> : null) },
  ]

  async function confirmDelete() {
    if (!pendingDelete) return
    const res = await api.invoke('teachingLoad:delete', { id: pendingDelete.id })
    setPendingDelete(null)
    if (res.ok) {
      notifySuccess(ruCommon.deletedOk)
      await refresh()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Нагрузка</h1>
        <div className="toolbar-actions">
          <FilterSelect
            label="Семестр"
            hint="Семестр, за который вводится и показывается нагрузка"
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
          <button type="button" className="btn btn-primary" disabled={selectedSemesterId === ''} onClick={() => setEditingRow('new')}>
            + Добавить нагрузку
          </button>
        </div>
      </div>

      {selectedSemesterId === '' ? (
        <p className="history-empty">Выберите семестр, чтобы увидеть и вводить нагрузку</p>
      ) : (
        <DataTable columns={columns} data={rows ?? []} onRowClick={(row) => setEditingRow(row)} />
      )}

      {editingRow != null && selectedSemesterId !== '' && (
        <TeachingLoadDialog
          semesterId={selectedSemesterId}
          row={editingRow === 'new' ? null : editingRow}
          groups={groups}
          teachers={teachers}
          disciplines={disciplineById}
          curriculumRows={curriculumRows}
          onClose={() => setEditingRow(null)}
          onDeleteRequested={(row) => {
            setEditingRow(null)
            setPendingDelete(row)
          }}
          onSaved={() => {
            setEditingRow(null)
            void refresh()
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          open
          title="Удалить строку нагрузки?"
          description={ruCommon.confirmDeleteBody}
          confirmLabel={ruCommon.yesDelete}
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
