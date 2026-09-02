import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import type { z } from 'zod'
import type { Cmc } from '../../../../shared/ipc/contract'
import { cmcSaveInput } from '../../../../shared/ipc/schemas'
import { api } from '../../api/client'
import { TextField } from '../../ui/form/TextField'
import { ruCommon } from '../../ui/locale'
import { ReferenceCrudPage, type ReferenceCrudAction } from '../../ui/ReferenceCrudPage'

type CmcFormValues = z.infer<typeof cmcSaveInput>

const columns: ColumnDef<Cmc>[] = [{ accessorKey: 'name', header: 'Название' }]

const defaultValues: CmcFormValues = { name: '' }

const actions: ReferenceCrudAction<Cmc>[] = [
  {
    key: 'delete',
    labelRu: () => ruCommon.delete,
    variant: 'danger',
    confirmTitleRu: (row) => `Удалить «${row.name}»?`,
    confirmBodyRu: () => ruCommon.confirmDeleteBody,
    confirmLabelRu: ruCommon.yesDelete,
    successRu: () => ruCommon.deletedOk,
    run: (row) => api.invoke('cmc:delete', { id: row.id }),
  },
]

export function CmcPage() {
  return (
    <ReferenceCrudPage<Cmc, CmcFormValues>
      entityName="cmc"
      titleRu="ЦМК"
      createTitleRu="Новая ЦМК"
      editTitleRu="ЦМК"
      columns={columns}
      resolver={zodResolver(cmcSaveInput)}
      defaultValues={defaultValues}
      toFormValues={(row) => ({ name: row.name })}
      renderFields={(control) => <TextField control={control} name="name" label="Название" />}
      list={() => api.invoke('cmc:list', {})}
      save={(values) => api.invoke('cmc:save', values)}
      actions={actions}
    />
  )
}
