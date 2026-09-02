import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import type { z } from 'zod'
import type { AcademicYear } from '../../../../shared/ipc/contract'
import { academicYearSaveInput } from '../../../../shared/ipc/schemas'
import { api } from '../../api/client'
import { DateField } from '../../ui/form/DateField'
import { TextField } from '../../ui/form/TextField'
import { ruCommon } from '../../ui/locale'
import { ReferenceCrudPage, type ReferenceCrudAction } from '../../ui/ReferenceCrudPage'

type AcademicYearFormValues = z.infer<typeof academicYearSaveInput>

const columns: ColumnDef<AcademicYear>[] = [
  { accessorKey: 'name', header: 'Учебный год' },
  { accessorKey: 'startsOn', header: 'Начало' },
  { accessorKey: 'endsOn', header: 'Окончание' },
]

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

const defaultValues: AcademicYearFormValues = { name: '', startsOn: todayIso(), endsOn: todayIso() }

const actions: ReferenceCrudAction<AcademicYear>[] = [
  {
    key: 'delete',
    labelRu: () => ruCommon.delete,
    variant: 'danger',
    confirmTitleRu: (row) => `Удалить учебный год «${row.name}»?`,
    confirmBodyRu: () => ruCommon.confirmDeleteBody,
    confirmLabelRu: ruCommon.yesDelete,
    successRu: () => ruCommon.deletedOk,
    run: (row) => api.invoke('academicYears:delete', { id: row.id }),
  },
]

/** Учебные годы (§2.8, минимальный срез вперёд — понадобился как зависимость §2.5). */
export function AcademicYearsPage() {
  return (
    <ReferenceCrudPage<AcademicYear, AcademicYearFormValues>
      entityName="academic_year"
      titleRu="Учебные годы"
      createTitleRu="Новый учебный год"
      editTitleRu="Учебный год"
      columns={columns}
      resolver={zodResolver(academicYearSaveInput)}
      defaultValues={defaultValues}
      toFormValues={(row) => ({ name: row.name, startsOn: row.startsOn, endsOn: row.endsOn })}
      renderFields={(control) => (
        <>
          <TextField control={control} name="name" label="Название" placeholder="2026/2027" />
          <DateField control={control} name="startsOn" label="Начало" />
          <DateField control={control} name="endsOn" label="Окончание" />
        </>
      )}
      list={() => api.invoke('academicYears:list', {})}
      save={(values) => api.invoke('academicYears:save', values)}
      actions={actions}
      initialSorting={[{ id: 'startsOn', desc: true }]}
    />
  )
}
