import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import { useWatch } from 'react-hook-form'
import type { z } from 'zod'
import type { Building } from '../../../../shared/ipc/contract'
import { buildingSaveInput } from '../../../../shared/ipc/schemas'
import { api } from '../../api/client'
import { CheckboxField } from '../../ui/form/CheckboxField'
import { SelectField } from '../../ui/form/SelectField'
import { TextField } from '../../ui/form/TextField'
import { ruCommon } from '../../ui/locale'
import { ReferenceCrudPage, type ReferenceCrudAction } from '../../ui/ReferenceCrudPage'
import type { Control } from 'react-hook-form'

type BuildingFormValues = z.infer<typeof buildingSaveInput>

const CLINICAL_MODE_LABEL: Record<NonNullable<Building['clinicalMode']>, string> = {
  full_day: 'Целый день на базе',
  block: 'Блоками',
  free: 'Свободно',
}

const columns: ColumnDef<Building>[] = [
  { accessorKey: 'name', header: 'Название' },
  { accessorKey: 'address', header: 'Адрес', cell: (info) => info.getValue() ?? '—' },
  {
    id: 'clinical',
    header: 'Клиническая база',
    cell: ({ row }) => (row.original.isClinical ? CLINICAL_MODE_LABEL[row.original.clinicalMode ?? 'free'] : '—'),
  },
]

const defaultValues: BuildingFormValues = { name: '', address: null, isClinical: false, clinicalMode: null }

const actions: ReferenceCrudAction<Building>[] = [
  {
    key: 'delete',
    labelRu: () => ruCommon.delete,
    variant: 'danger',
    confirmTitleRu: (row) => `Удалить «${row.name}»?`,
    confirmBodyRu: () => ruCommon.confirmDeleteBody,
    confirmLabelRu: ruCommon.yesDelete,
    successRu: () => ruCommon.deletedOk,
    run: (row) => api.invoke('buildings:delete', { id: row.id }),
  },
]

function BuildingFields({ control }: { control: Control<BuildingFormValues> }) {
  const isClinical = useWatch({ control, name: 'isClinical' })
  return (
    <>
      <TextField control={control} name="name" label="Название корпуса" />
      <TextField control={control} name="address" label="Адрес" nullable />
      <CheckboxField control={control} name="isClinical" label="Клиническая база" />
      {isClinical && (
        <SelectField
          control={control}
          name="clinicalMode"
          label="Режим работы на базе"
          nullable
          options={Object.entries(CLINICAL_MODE_LABEL).map(([value, label]) => ({ value, label }))}
        />
      )}
    </>
  )
}

export function BuildingsPage() {
  return (
    <ReferenceCrudPage<Building, BuildingFormValues>
      entityName="building"
      titleRu="Корпуса"
      createTitleRu="Новый корпус"
      editTitleRu="Корпус"
      columns={columns}
      resolver={zodResolver(buildingSaveInput)}
      defaultValues={defaultValues}
      toFormValues={(row) => ({
        name: row.name,
        address: row.address,
        isClinical: row.isClinical,
        clinicalMode: row.clinicalMode,
      })}
      renderFields={(control) => <BuildingFields control={control} />}
      list={() => api.invoke('buildings:list', {})}
      save={(values) => api.invoke('buildings:save', values)}
      actions={actions}
    />
  )
}
