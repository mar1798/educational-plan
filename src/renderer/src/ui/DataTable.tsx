import { Fragment, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
} from '@tanstack/react-table'
import { paginationLabel, ruCommon } from './locale'

interface DataTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string
  getRowId?: (row: T) => string
  initialSorting?: SortingState
  /** Заголовок группы строк (§2.7: дисциплины по блокам и циклам) — вставляется, когда значение меняется. */
  groupHeader?: (row: T) => string
}

export function DataTable<T>({ columns, data, onRowClick, rowClassName, getRowId, initialSorting, groupHeader }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? [])
  const [globalFilter, setGlobalFilter] = useState('')

  const table = useReactTable<T>({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    ...(getRowId ? { getRowId: (row: T) => getRowId(row) } : {}),
    initialState: { pagination: { pageSize: 20 } },
  })

  // Заголовки групп имеют смысл только в исходном порядке: если завуч отсортировал таблицу
  // по другой колонке, строки одной группы перестают идти подряд — заголовки скрываем.
  const groupingActive = groupHeader != null && JSON.stringify(sorting) === JSON.stringify(initialSorting ?? [])

  const rows = table.getRowModel().rows
  const filteredCount = table.getFilteredRowModel().rows.length
  const pagination = table.getState().pagination

  return (
    <div>
      <div className="page-toolbar">
        <input
          className="search-input"
          placeholder={ruCommon.search}
          value={globalFilter}
          onChange={(e) => table.setGlobalFilter(e.target.value)}
        />
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const sortDir = header.column.getIsSorted()
                  return (
                    <th key={header.id} onClick={header.column.getToggleSortingHandler()}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      {sortDir === 'asc' && ' ▲'}
                      {sortDir === 'desc' && ' ▼'}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row: Row<T>, idx: number) => {
              const group = groupingActive ? groupHeader!(row.original) : undefined
              const prevGroup = groupingActive && idx > 0 ? groupHeader!(rows[idx - 1]!.original) : undefined
              return (
                <Fragment key={row.id}>
                  {group != null && group !== prevGroup && (
                    <tr className="data-table-group">
                      <td colSpan={row.getVisibleCells().length}>{group}</td>
                    </tr>
                  )}
                  <tr className={rowClassName?.(row.original)} onClick={() => onRowClick?.(row.original)}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                    ))}
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="data-table-empty">{ruCommon.emptyTable}</div>}
        <div className="data-table-footer">
          <span>{paginationLabel(pagination.pageIndex, pagination.pageSize, filteredCount)}</span>
          <div>
            <button className="btn" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
              ←
            </button>
            <button className="btn" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
              →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
