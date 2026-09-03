import type { ColumnDef } from '@tanstack/react-table'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Curriculum, CurriculumRow, Discipline } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { DataTable } from '../../ui/DataTable'
import { notifyError } from '../../ui/toast'
import { CurriculumRowDialog } from './CurriculumRowDialog'
import { PasteCurriculumRowsDialog } from './PasteCurriculumRowsDialog'

const CYCLE_LABEL: Record<Discipline['cycle'], string> = {
  spo1: 'СПО.1',
  spo2: 'СПО.2',
  spo3: 'СПО.3',
  spo4: 'СПО.4',
  spo5: 'СПО.5',
}

const STATUS_LABEL: Record<Curriculum['status'], string> = {
  draft: 'Черновик',
  approved: 'Утверждён',
  archived: 'В архиве',
}

/**
 * Редактор учебного плана (§3.1): таблица «дисциплина × семестр × кредиты × часы
 * по четырём видам × СРС», сгруппированная по блокам и циклам, как в исходном плане
 * колледжа (§4.8). Правка утверждённой строки версионируется — диалог строки сам
 * решает, показывать ли предпросмотр затронутых занятий (§3.2).
 */
export function CurriculumEditorPage() {
  const params = useParams<{ id: string }>()
  const curriculumId = Number(params.id)
  const navigate = useNavigate()

  const [plan, setPlan] = useState<Curriculum | null>(null)
  const [rows, setRows] = useState<CurriculumRow[] | null>(null)
  const [disciplines, setDisciplines] = useState<Discipline[]>([])
  const [editingRow, setEditingRow] = useState<CurriculumRow | 'new' | null>(null)
  const [pasting, setPasting] = useState(false)

  const refreshRows = useCallback(
    () =>
      api.invoke('curriculumRows:list', { curriculumId }).then((res) => {
        if (res.ok) setRows(res.value)
        else notifyError(res.error.message)
      }),
    [curriculumId],
  )

  useEffect(() => {
    void api.invoke('curricula:list', { includeArchived: true }).then((res) => {
      if (res.ok) setPlan(res.value.find((p) => p.id === curriculumId) ?? null)
    })
    void api.invoke('disciplines:list', { includeArchived: true }).then((res) => {
      if (res.ok) setDisciplines(res.value)
    })
    void refreshRows()
  }, [curriculumId, refreshRows])

  const disciplineById = useMemo(() => new Map(disciplines.map((d) => [d.id, d])), [disciplines])

  // Порядок строк — блок → цикл → дисциплина: заголовки групп в DataTable вставляются,
  // когда значение меняется, поэтому строки одного блока и цикла должны идти подряд.
  const activeRows = useMemo(() => {
    const key = (r: CurriculumRow) => {
      const d = disciplineById.get(r.disciplineId)
      return [d?.block ?? 99, d?.cycle ?? 'zzz', d?.name ?? `#${r.disciplineId}`, r.semesterNo] as const
    }
    return (rows ?? [])
      .filter((r) => r.validTo == null)
      .sort((a, b) => {
        const ka = key(a)
        const kb = key(b)
        for (let i = 0; i < ka.length; i++) {
          if (ka[i]! < kb[i]!) return -1
          if (ka[i]! > kb[i]!) return 1
        }
        return 0
      })
  }, [rows, disciplineById])

  // Строки сумм по блокам и циклам (§3.1) считаются автоматически из тех же активных строк.
  const groupTotals = useMemo(() => {
    const totals = new Map<string, { block: number; cycle: string; credits: number; hoursTotal: number; hoursClassroom: number; hoursSrs: number }>()
    for (const r of activeRows) {
      const d = disciplineById.get(r.disciplineId)
      const block = d?.block ?? 0
      const cycle = d ? CYCLE_LABEL[d.cycle] : '—'
      const key = `${block}/${cycle}`
      const acc = totals.get(key) ?? { block, cycle, credits: 0, hoursTotal: 0, hoursClassroom: 0, hoursSrs: 0 }
      acc.credits += r.credits
      acc.hoursTotal += r.hoursTotal
      acc.hoursClassroom += r.hoursClassroom
      acc.hoursSrs += r.hoursSrs
      totals.set(key, acc)
    }
    return [...totals.values()]
  }, [activeRows, disciplineById])

  const blockTotals = useMemo(() => {
    const totals = new Map<number, { block: number; credits: number; hoursTotal: number; hoursClassroom: number; hoursSrs: number }>()
    for (const g of groupTotals) {
      const acc = totals.get(g.block) ?? { block: g.block, credits: 0, hoursTotal: 0, hoursClassroom: 0, hoursSrs: 0 }
      acc.credits += g.credits
      acc.hoursTotal += g.hoursTotal
      acc.hoursClassroom += g.hoursClassroom
      acc.hoursSrs += g.hoursSrs
      totals.set(g.block, acc)
    }
    return [...totals.values()].sort((a, b) => a.block - b.block)
  }, [groupTotals])

  const semesterTotals = useMemo(() => {
    const bySemester = new Map<number, number>()
    for (const r of activeRows) bySemester.set(r.semesterNo, (bySemester.get(r.semesterNo) ?? 0) + r.credits)
    return [...bySemester.entries()].sort((a, b) => a[0] - b[0])
  }, [activeRows])

  const columns: ColumnDef<CurriculumRow>[] = [
    { id: 'discipline', header: 'Дисциплина', accessorFn: (r) => disciplineById.get(r.disciplineId)?.name ?? `#${r.disciplineId}` },
    { accessorKey: 'course', header: 'Курс' },
    { accessorKey: 'semesterNo', header: 'Семестр' },
    { accessorKey: 'credits', header: 'Кредиты' },
    { accessorKey: 'hoursTotal', header: 'Всего часов' },
    { accessorKey: 'hoursClassroom', header: 'Аудиторных' },
    { accessorKey: 'hoursTheory', header: 'Теор.' },
    { accessorKey: 'hoursPractice', header: 'Практ.' },
    { accessorKey: 'hoursSeminar', header: 'Семин.' },
    { accessorKey: 'hoursLab', header: 'Лабор.' },
    { accessorKey: 'hoursSrs', header: 'СРС' },
    {
      id: 'invariant',
      header: '',
      cell: ({ row }) =>
        row.original.credits * 30 !== row.original.hoursTotal ? (
          <span className="badge badge-warning" title="Кредиты × 30 должно равняться всего часов">
            кред.×30≠часы
          </span>
        ) : null,
    },
  ]

  const groupHeader = (row: CurriculumRow) => {
    const d = disciplineById.get(row.disciplineId)
    return d ? `Блок ${d.block} · ${CYCLE_LABEL[d.cycle]}` : '—'
  }


  if (plan === null) return <p className="history-empty">Загрузка…</p>

  return (
    <div>
      <div className="page-header">
        <div>
          <button type="button" className="btn-link" onClick={() => navigate('/curricula')}>
            ← К списку планов
          </button>
          <h1>
            {plan.name} <span className="badge">{STATUS_LABEL[plan.status]}</span>
          </h1>
        </div>
        <div className="toolbar-actions">
          <button type="button" className="btn" onClick={() => setPasting(true)}>
            Вставить из буфера
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setEditingRow('new')}>
            + Добавить строку
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={activeRows}
        onRowClick={(row) => setEditingRow(row)}
        groupHeader={groupHeader}
      />

      <div className="card">
        <h3>Итоги по блокам и циклам</h3>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Блок / цикл</th>
                <th>Кредиты</th>
                <th>Всего часов</th>
                <th>Аудиторных</th>
                <th>СРС</th>
              </tr>
            </thead>
            <tbody>
              {blockTotals.map((b) => (
                <Fragment key={b.block}>
                  <tr className="data-table-group">
                    <td>Блок {b.block}</td>
                    <td>{b.credits}</td>
                    <td>{b.hoursTotal}</td>
                    <td>{b.hoursClassroom}</td>
                    <td>{b.hoursSrs}</td>
                  </tr>
                  {groupTotals
                    .filter((g) => g.block === b.block)
                    .map((g) => (
                      <tr key={g.cycle}>
                        <td>{g.cycle}</td>
                        <td>{g.credits}</td>
                        <td>{g.hoursTotal}</td>
                        <td>{g.hoursClassroom}</td>
                        <td>{g.hoursSrs}</td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {activeRows.length === 0 && <p className="history-empty">В плане пока нет строк</p>}
      </div>

      <div className="card">
        <h3>Кредиты по семестрам</h3>
        <p className="history-empty">Норма — 30 кредитов в семестре (§1.1 п.32); расхождение подсвечивается, но не блокирует.</p>
        <div className="btn-group" style={{ flexWrap: 'wrap', gap: 8 }}>
          {semesterTotals.map(([sem, total]) => (
            <span key={sem} className={`badge${total !== 30 ? ' badge-warning' : ''}`}>
              {sem}-й сем.: {total} кред.
            </span>
          ))}
        </div>
      </div>

      {editingRow != null && (
        <CurriculumRowDialog
          curriculum={plan}
          row={editingRow === 'new' ? null : editingRow}
          disciplines={disciplines}
          onClose={() => setEditingRow(null)}
          onSaved={() => {
            setEditingRow(null)
            void refreshRows()
          }}
        />
      )}

      {pasting && (
        <PasteCurriculumRowsDialog
          curriculumId={curriculumId}
          onClose={() => setPasting(false)}
          onDone={() => {
            setPasting(false)
            void refreshRows()
          }}
        />
      )}
    </div>
  )
}
