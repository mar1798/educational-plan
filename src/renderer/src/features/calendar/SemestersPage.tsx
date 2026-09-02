import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import { useEffect, useState } from 'react'
import type { Control } from 'react-hook-form'
import type { z } from 'zod'
import type { AcademicYear, Semester } from '../../../../shared/ipc/contract'
import { semesterSaveInput } from '../../../../shared/ipc/schemas'
import { api } from '../../api/client'
import { DateField } from '../../ui/form/DateField'
import { NumberField } from '../../ui/form/NumberField'
import { SelectField } from '../../ui/form/SelectField'
import { ruCommon } from '../../ui/locale'
import { ReferenceCrudPage, type ReferenceCrudAction } from '../../ui/ReferenceCrudPage'

type SemesterFormValues = z.infer<typeof semesterSaveInput>

const STATUS_LABEL: Record<Semester['status'], string> = {
  planning: 'Планирование',
  active: 'Идёт',
  closed: 'Закрыт',
}

function buildColumns(yearNameById: Map<number, string>): ColumnDef<Semester>[] {
  return [
    { id: 'year', header: 'Учебный год', accessorFn: (row) => yearNameById.get(row.academicYearId) ?? row.academicYearId },
    { id: 'no', header: 'Семестр', accessorFn: (row) => `${row.no}-й` },
    { accessorKey: 'startsOn', header: 'Начало' },
    { accessorKey: 'endsOn', header: 'Окончание' },
    { accessorKey: 'weeksCount', header: 'Недель' },
    { id: 'status', header: 'Статус', accessorFn: (row) => STATUS_LABEL[row.status] },
  ]
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

const actions: ReferenceCrudAction<Semester>[] = [
  {
    key: 'delete',
    labelRu: () => ruCommon.delete,
    variant: 'danger',
    confirmTitleRu: (row) => `Удалить ${row.no}-й семестр?`,
    confirmBodyRu: () => ruCommon.confirmDeleteBody,
    confirmLabelRu: ruCommon.yesDelete,
    successRu: () => ruCommon.deletedOk,
    run: (row) => api.invoke('semesters:delete', { id: row.id }),
  },
]

function SemesterFields({ control, years }: { control: Control<SemesterFormValues>; years: AcademicYear[] }) {
  return (
    <>
      <SelectField
        control={control}
        name="academicYearId"
        label="Учебный год"
        valueType="number"
        options={years.map((y) => ({ value: String(y.id), label: y.name }))}
      />
      <SelectField
        control={control}
        name="no"
        label="Семестр"
        valueType="number"
        options={[
          { value: '1', label: '1-й' },
          { value: '2', label: '2-й' },
        ]}
      />
      <DateField control={control} name="startsOn" label="Начало" />
      <DateField control={control} name="endsOn" label="Окончание" />
      <NumberField control={control} name="weeksCount" label="Число недель" min={1} />
      <SelectField
        control={control}
        name="status"
        label="Статус"
        options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
      />
    </>
  )
}

/** Семестры (§2.8, минимальный срез вперёд — понадобился как зависимость §2.5: схема деления привязана к семестру). */
export function SemestersPage() {
  const [years, setYears] = useState<AcademicYear[]>([])

  useEffect(() => {
    void api.invoke('academicYears:list', {}).then((res) => {
      if (res.ok) setYears(res.value)
    })
  }, [])

  const yearNameById = new Map(years.map((y) => [y.id, y.name]))
  const defaultValues: SemesterFormValues = {
    academicYearId: years[0]?.id ?? 0,
    no: 1,
    startsOn: todayIso(),
    endsOn: todayIso(),
    weeksCount: 18,
    status: 'planning',
  }

  return (
    <ReferenceCrudPage<Semester, SemesterFormValues>
      entityName="semester"
      titleRu="Семестры"
      createTitleRu="Новый семестр"
      editTitleRu="Семестр"
      columns={buildColumns(yearNameById)}
      resolver={zodResolver(semesterSaveInput)}
      defaultValues={defaultValues}
      toFormValues={(row) => ({
        academicYearId: row.academicYearId,
        no: row.no,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        weeksCount: row.weeksCount,
        status: row.status,
      })}
      renderFields={(control) => <SemesterFields control={control} years={years} />}
      list={() => api.invoke('semesters:list', {})}
      save={(values) => api.invoke('semesters:save', values)}
      actions={actions}
      initialSorting={[{ id: 'startsOn', desc: true }]}
    />
  )
}
