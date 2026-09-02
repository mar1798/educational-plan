import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import type { z } from 'zod'
import type { Speciality } from '../../../../shared/ipc/contract'
import { specialitySaveInput } from '../../../../shared/ipc/schemas'
import { api } from '../../api/client'
import { NumberField } from '../../ui/form/NumberField'
import { TextField } from '../../ui/form/TextField'
import { ruCommon } from '../../ui/locale'
import { ReferenceCrudPage, type ReferenceCrudAction } from '../../ui/ReferenceCrudPage'

type SpecialityFormValues = z.infer<typeof specialitySaveInput>

const columns: ColumnDef<Speciality>[] = [
  { accessorKey: 'code', header: 'Код' },
  { accessorKey: 'name', header: 'Название' },
  { accessorKey: 'qualification', header: 'Квалификация', cell: (info) => info.getValue() ?? '—' },
  { accessorKey: 'semestersTotal', header: 'Семестров' },
  {
    id: 'status',
    header: '',
    cell: ({ row }) => (row.original.archivedAt ? <span className="badge">В архиве</span> : null),
  },
]

const defaultValues: SpecialityFormValues = { code: '', name: '', qualification: null, semestersTotal: 6 }

const actions: ReferenceCrudAction<Speciality>[] = [
  {
    key: 'archive',
    labelRu: (row) => (row.archivedAt ? ruCommon.restore : ruCommon.archive),
    confirmTitleRu: (row) => (row.archivedAt ? 'Восстановить специальность из архива?' : 'Архивировать специальность?'),
    successRu: (row) => (row.archivedAt ? ruCommon.restoredOk : ruCommon.archivedOk),
    run: (row) => api.invoke('specialities:archive', { id: row.id, rowVersion: row.rowVersion, archived: !row.archivedAt }),
  },
]

export function SpecialitiesPage() {
  return (
    <ReferenceCrudPage<Speciality, SpecialityFormValues>
      entityName="speciality"
      titleRu="Специальности"
      createTitleRu="Новая специальность"
      editTitleRu="Специальность"
      columns={columns}
      resolver={zodResolver(specialitySaveInput)}
      defaultValues={defaultValues}
      toFormValues={(row) => ({
        code: row.code,
        name: row.name,
        qualification: row.qualification,
        semestersTotal: row.semestersTotal,
      })}
      renderFields={(control) => (
        <>
          <TextField control={control} name="code" label="Код специальности" />
          <TextField control={control} name="name" label="Название" />
          <TextField control={control} name="qualification" label="Квалификация" nullable />
          <NumberField control={control} name="semestersTotal" label="Семестров всего" min={1} max={12} />
        </>
      )}
      list={(includeArchived) => api.invoke('specialities:list', { includeArchived })}
      save={(values) => api.invoke('specialities:save', values)}
      actions={actions}
      hasArchivedFilter
      rowClassName={(row) => (row.archivedAt ? 'archived-row' : '')}
    />
  )
}
