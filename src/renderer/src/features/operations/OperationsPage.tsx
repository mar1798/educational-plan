import type { ColumnDef } from '@tanstack/react-table'
import { useCallback, useEffect, useState } from 'react'
import type { OperationSummary } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { DataTable } from '../../ui/DataTable'
import { notifyError, notifySuccess } from '../../ui/toast'

const KIND_LABEL: Record<OperationSummary['kind'], string> = {
  generate: 'Генерация расписания',
  rollout: 'Развёртывание шаблона',
  import: 'Импорт',
  bulk_edit: 'Массовая правка',
  restore: 'Восстановление',
}

const STATUS_LABEL: Record<OperationSummary['status'], string> = {
  preview: 'Предпросмотр',
  applied: 'Применена',
  undone: 'Отменена',
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('ru-RU') : '—'
}

const columns: ColumnDef<OperationSummary>[] = [
  { accessorKey: 'id', header: '#' },
  { id: 'kind', header: 'Тип', accessorFn: (row) => KIND_LABEL[row.kind] },
  { id: 'status', header: 'Статус', accessorFn: (row) => STATUS_LABEL[row.status] },
  { id: 'startedAt', header: 'Начата', accessorFn: (row) => formatDate(row.startedAt) },
  { id: 'finishedAt', header: 'Завершена', accessorFn: (row) => formatDate(row.finishedAt) },
  { accessorKey: 'createdBy', header: 'Пользователь' },
]

/** Просмотр операций (§1.5) и откат: любая массовая правка (в т.ч. объединение групп, §2.4) идёт через operation. */
export function OperationsPage() {
  const [operations, setOperations] = useState<OperationSummary[] | null>(null)
  const [pendingUndo, setPendingUndo] = useState<OperationSummary | null>(null)

  const refresh = useCallback(
    () =>
      api.invoke('operations:list', {}).then((res) => {
        if (res.ok) setOperations(res.value)
        else notifyError(res.error.message)
      }),
    [],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function confirmUndo() {
    if (!pendingUndo) return
    const res = await api.invoke('operations:undo', { operationId: pendingUndo.id })
    setPendingUndo(null)
    if (res.ok) {
      notifySuccess(`Операция #${pendingUndo.id} отменена`)
      await refresh()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Операции</h1>
      </div>

      <DataTable
        columns={[
          ...columns,
          {
            id: 'undo',
            header: '',
            cell: ({ row }) =>
              row.original.status === 'applied' ? (
                <button className="btn btn-danger" onClick={() => setPendingUndo(row.original)}>
                  Отменить
                </button>
              ) : null,
          },
        ]}
        data={operations ?? []}
        initialSorting={[{ id: 'id', desc: true }]}
      />

      {pendingUndo && (
        <ConfirmDialog
          open
          title={`Отменить операцию #${pendingUndo.id}?`}
          description="Строки, изменённые этой операцией, будут возвращены к состоянию до неё."
          confirmLabel="Да, отменить"
          danger
          onConfirm={() => void confirmUndo()}
          onCancel={() => setPendingUndo(null)}
        />
      )}
    </div>
  )
}
