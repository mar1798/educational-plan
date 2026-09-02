import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import { useEffect, useState } from 'react'
import type { Control } from 'react-hook-form'
import type { z } from 'zod'
import type { CalendarPeriod, Speciality, StudyGroup } from '../../../../shared/ipc/contract'
import { calendarPeriodSaveInput } from '../../../../shared/ipc/schemas'
import { api } from '../../api/client'
import { NumberField } from '../../ui/form/NumberField'
import { SelectField } from '../../ui/form/SelectField'
import { DateField } from '../../ui/form/DateField'
import { TextField } from '../../ui/form/TextField'
import { ruCommon } from '../../ui/locale'
import { ReferenceCrudPage, type ReferenceCrudAction } from '../../ui/ReferenceCrudPage'

type CalendarPeriodFormValues = z.infer<typeof calendarPeriodSaveInput>

const KIND_LABEL: Record<CalendarPeriod['kind'], string> = {
  theory: 'Теоретическое обучение',
  practice: 'Практика',
  prequal_practice: 'Преддипломная практика',
  vacation: 'Каникулы',
  session: 'Сессия',
  iga: 'ИГА',
  quarantine: 'Карантин',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function buildColumns(specialityNameById: Map<number, string>, groupNameById: Map<number, string>): ColumnDef<CalendarPeriod>[] {
  return [
    { id: 'kind', header: 'Тип', accessorFn: (row) => KIND_LABEL[row.kind] },
    { accessorKey: 'startsOn', header: 'Начало' },
    { accessorKey: 'endsOn', header: 'Окончание' },
    { id: 'course', header: 'Курс', accessorFn: (row) => row.course ?? '—' },
    {
      id: 'speciality',
      header: 'Специальность',
      accessorFn: (row) => (row.specialityId != null ? (specialityNameById.get(row.specialityId) ?? row.specialityId) : 'Все'),
    },
    {
      id: 'group',
      header: 'Группа',
      accessorFn: (row) => (row.groupId != null ? (groupNameById.get(row.groupId) ?? row.groupId) : 'Все'),
    },
    { accessorKey: 'note', header: 'Примечание', cell: (info) => info.getValue() ?? '—' },
  ]
}

const actions: ReferenceCrudAction<CalendarPeriod>[] = [
  {
    key: 'delete',
    labelRu: () => ruCommon.delete,
    variant: 'danger',
    confirmTitleRu: (row) => `Удалить период «${KIND_LABEL[row.kind]}»?`,
    confirmBodyRu: () => ruCommon.confirmDeleteBody,
    confirmLabelRu: ruCommon.yesDelete,
    successRu: () => ruCommon.deletedOk,
    run: (row) => api.invoke('calendarPeriods:delete', { id: row.id }),
  },
]

function CalendarPeriodFields({
  control,
  specialities,
  groups,
}: {
  control: Control<CalendarPeriodFormValues>
  specialities: Speciality[]
  groups: StudyGroup[]
}) {
  return (
    <>
      <SelectField
        control={control}
        name="kind"
        label="Тип периода"
        options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
      />
      <DateField control={control} name="startsOn" label="Начало" />
      <DateField control={control} name="endsOn" label="Окончание" />
      <NumberField control={control} name="course" label="Курс" nullable min={1} max={6} />
      <SelectField
        control={control}
        name="specialityId"
        label="Специальность"
        valueType="number"
        nullable
        nullLabel="Все специальности"
        options={specialities.map((s) => ({ value: String(s.id), label: s.name }))}
      />
      <SelectField
        control={control}
        name="groupId"
        label="Группа"
        valueType="number"
        nullable
        nullLabel="Все группы"
        options={groups.map((g) => ({ value: String(g.id), label: g.name }))}
      />
      <TextField control={control} name="note" label="Примечание" nullable />
    </>
  )
}

const defaultValues: CalendarPeriodFormValues = {
  kind: 'vacation',
  course: null,
  specialityId: null,
  groupId: null,
  startsOn: todayIso(),
  endsOn: todayIso(),
  note: null,
}

/** Периоды графика учебного процесса (§2.8): каникулы, практика, сессия и т.п. — вручную. */
export function CalendarPeriodsPage() {
  const [specialities, setSpecialities] = useState<Speciality[]>([])
  const [groups, setGroups] = useState<StudyGroup[]>([])

  useEffect(() => {
    void api.invoke('specialities:list', {}).then((res) => {
      if (res.ok) setSpecialities(res.value)
    })
    void api.invoke('groups:list', { includeClosed: false }).then((res) => {
      if (res.ok) setGroups(res.value)
    })
  }, [])

  const specialityNameById = new Map(specialities.map((s) => [s.id, s.name]))
  const groupNameById = new Map(groups.map((g) => [g.id, g.name]))

  return (
    <ReferenceCrudPage<CalendarPeriod, CalendarPeriodFormValues>
      entityName="calendar_period"
      titleRu="Периоды учебного процесса"
      createTitleRu="Новый период"
      editTitleRu="Период"
      columns={buildColumns(specialityNameById, groupNameById)}
      resolver={zodResolver(calendarPeriodSaveInput)}
      defaultValues={defaultValues}
      toFormValues={(row) => ({
        kind: row.kind,
        course: row.course,
        specialityId: row.specialityId,
        groupId: row.groupId,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        note: row.note,
      })}
      renderFields={(control) => <CalendarPeriodFields control={control} specialities={specialities} groups={groups} />}
      list={() => api.invoke('calendarPeriods:list', {})}
      save={(values) => api.invoke('calendarPeriods:save', values)}
      actions={actions}
      initialSorting={[{ id: 'startsOn', desc: true }]}
    />
  )
}
