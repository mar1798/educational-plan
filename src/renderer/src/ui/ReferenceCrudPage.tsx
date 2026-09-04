import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useForm, type Control, type DefaultValues, type FieldValues, type Resolver } from 'react-hook-form'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import type { AppError, Result } from '../../../shared/result'
import { ConfirmDialog } from './ConfirmDialog'
import { DataTable } from './DataTable'
import { Dialog } from './Dialog'
import { EntityHistoryPanel } from './EntityHistoryPanel'
import { ruCommon } from './locale'
import { notifyError, notifySuccess } from './toast'

export interface ReferenceCrudAction<TRow> {
  key: string
  labelRu: (row: TRow) => string
  variant?: 'default' | 'danger'
  hidden?: (row: TRow) => boolean
  confirmTitleRu?: (row: TRow) => string
  confirmBodyRu?: (row: TRow) => string
  confirmLabelRu?: string
  successRu: (row: TRow) => string
  run: (row: TRow) => Promise<Result<{ ok: true }, AppError>>
}

export interface ReferenceCrudConfig<TRow extends { id: number; rowVersion: number }, TFormValues extends FieldValues> {
  entityName: string
  titleRu: string
  createTitleRu: string
  editTitleRu: string
  columns: ColumnDef<TRow>[]
  resolver: Resolver<TFormValues>
  defaultValues: TFormValues
  toFormValues: (row: TRow) => TFormValues
  renderFields: (control: Control<TFormValues>) => ReactNode
  list: (includeArchived: boolean) => Promise<Result<TRow[], AppError>>
  save: (values: TFormValues & { id?: number; rowVersion?: number }) => Promise<Result<TRow, AppError>>
  actions?: ReferenceCrudAction<TRow>[]
  hasArchivedFilter?: boolean
  archivedFilterLabelRu?: string
  rowClassName?: (row: TRow) => string
  initialSorting?: SortingState
  /** Заголовок группы строк — §2.7: дисциплины сгруппированы по блокам и циклам. */
  groupHeader?: (row: TRow) => string
  /** Вложенные под-разделы (историчные связи и т.п.) — вне <form>, чтобы не вкладывать формы друг в друга. */
  renderExtra?: (row: TRow) => ReactNode
  /** Доп. кнопка(и) в шапке рядом с «Добавить» — для действий не над одной строкой (например, слияние). */
  toolbarExtra?: ReactNode
}

/**
 * Общая страница справочника (§2.1): таблица + диалог создания/правки + набор действий
 * (архивация/закрытие/удаление, задаётся вызывающей стороной) + история изменений (§2.10).
 */
export function ReferenceCrudPage<TRow extends { id: number; rowVersion: number }, TFormValues extends FieldValues>(
  config: ReferenceCrudConfig<TRow, TFormValues>,
) {
  const [rows, setRows] = useState<TRow[] | null>(null)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [dialogMode, setDialogMode] = useState<'closed' | 'create' | 'edit'>('closed')
  const [editingRow, setEditingRow] = useState<TRow | null>(null)
  const [pendingAction, setPendingAction] = useState<ReferenceCrudAction<TRow> | null>(null)

  const form = useForm<TFormValues, unknown, TFormValues>({
    resolver: config.resolver,
    defaultValues: config.defaultValues as DefaultValues<TFormValues>,
  })

  const refresh = useCallback(
    () =>
      config.list(includeArchived).then((res) => {
        if (res.ok) setRows(res.value)
        else notifyError(res.error.message)
      }),
    // config.list переопределяется на каждый рендер конфигом сверху — сравнивать по includeArchived достаточно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [includeArchived],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  function openCreate() {
    setEditingRow(null)
    form.reset(config.defaultValues)
    setDialogMode('create')
  }

  function openEdit(row: TRow) {
    setEditingRow(row)
    form.reset(config.toFormValues(row))
    setDialogMode('edit')
  }

  function closeDialog() {
    setDialogMode('closed')
    setEditingRow(null)
    setPendingAction(null)
  }

  async function onSubmit(values: TFormValues) {
    const payload = { ...values, id: editingRow?.id, rowVersion: editingRow?.rowVersion } as TFormValues & {
      id?: number
      rowVersion?: number
    }
    const res = await config.save(payload)
    if (res.ok) {
      notifySuccess(ruCommon.savedOk)
      closeDialog()
      await refresh()
    } else {
      notifyError(res.error.message)
    }
  }

  async function runAction(action: ReferenceCrudAction<TRow>, row: TRow) {
    const res = await action.run(row)
    setPendingAction(null)
    if (res.ok) {
      notifySuccess(action.successRu(row))
      await refresh()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>{config.titleRu}</h1>
        <div className="toolbar-actions">
          {config.hasArchivedFilter && (
            <label>
              <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
              {config.archivedFilterLabelRu ?? ruCommon.showArchived}
            </label>
          )}
          {config.toolbarExtra}
          <button className="btn btn-primary" onClick={openCreate}>
            + {ruCommon.create}
          </button>
        </div>
      </div>

      <DataTable
        columns={config.columns}
        data={rows ?? []}
        onRowClick={openEdit}
        rowClassName={config.rowClassName}
        initialSorting={config.initialSorting}
        groupHeader={config.groupHeader}
      />

      <Dialog
        open={dialogMode !== 'closed'}
        onOpenChange={(open) => !open && closeDialog()}
        title={dialogMode === 'edit' ? config.editTitleRu : config.createTitleRu}
      >
        <form onSubmit={form.handleSubmit(onSubmit)}>
          {config.renderFields(form.control)}
          <div className="dialog-actions-split">
            <div className="btn-group">
              {dialogMode === 'edit' &&
                editingRow &&
                config.actions
                  ?.filter((action) => !action.hidden?.(editingRow))
                  .map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      className={action.variant === 'danger' ? 'btn btn-danger' : 'btn'}
                      onClick={() => (action.confirmTitleRu ? setPendingAction(action) : void runAction(action, editingRow))}
                    >
                      {action.labelRu(editingRow)}
                    </button>
                  ))}
            </div>
            <div className="btn-group">
              <button type="button" className="btn" onClick={closeDialog}>
                {ruCommon.cancel}
              </button>
              {/* Без блокировки двойной клик по «Сохранить» создавал две одинаковые записи:
                  форма остаётся открытой на всё время запроса. */}
              <button type="submit" className="btn btn-primary" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Сохраняем…' : ruCommon.save}
              </button>
            </div>
          </div>
        </form>
        {dialogMode === 'edit' && editingRow && config.renderExtra?.(editingRow)}
        {dialogMode === 'edit' && editingRow && <EntityHistoryPanel entity={config.entityName} id={editingRow.id} />}
      </Dialog>

      {pendingAction && editingRow && (
        <ConfirmDialog
          open
          title={pendingAction.confirmTitleRu!(editingRow)}
          description={pendingAction.confirmBodyRu?.(editingRow)}
          confirmLabel={pendingAction.confirmLabelRu ?? ruCommon.confirm}
          danger={pendingAction.variant === 'danger'}
          onConfirm={() => void runAction(pendingAction, editingRow)}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  )
}
