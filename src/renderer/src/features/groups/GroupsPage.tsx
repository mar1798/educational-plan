import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import { useEffect, useState } from 'react'
import type { Control } from 'react-hook-form'
import type { z } from 'zod'
import type { Speciality, StudyGroup } from '../../../../shared/ipc/contract'
import { groupSaveInput } from '../../../../shared/ipc/schemas'
import { api } from '../../api/client'
import { NumberField } from '../../ui/form/NumberField'
import { SelectField } from '../../ui/form/SelectField'
import { TextField } from '../../ui/form/TextField'
import { DateField } from '../../ui/form/DateField'
import { ruCommon } from '../../ui/locale'
import { ReferenceCrudPage, type ReferenceCrudAction } from '../../ui/ReferenceCrudPage'
import { MergeGroupsDialog } from './MergeGroupsDialog'
import { SubgroupSchemesPanel } from './SubgroupSchemesPanel'

type GroupFormValues = z.infer<typeof groupSaveInput>

const FUNDING_LABEL: Record<StudyGroup['funding'], string> = {
  budget: 'Бюджет',
  contract: 'Контракт',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function buildColumns(specialityNameById: Map<number, string>): ColumnDef<StudyGroup>[] {
  return [
    { accessorKey: 'name', header: 'Группа' },
    // Пока справочник специальностей не доехал, в колонке стоит прочерк, а не сырой id:
    // список групп приходит раньше, и таблица успевала показать «3» вместо «Акушерское дело».
    { id: 'speciality', header: 'Специальность', accessorFn: (row) => specialityNameById.get(row.specialityId) ?? '—' },
    { accessorKey: 'course', header: 'Курс' },
    { accessorKey: 'admissionYear', header: 'Год набора' },
    { accessorKey: 'studentsCount', header: 'Студентов' },
    { id: 'funding', header: 'Финансирование', accessorFn: (row) => FUNDING_LABEL[row.funding] },
    {
      id: 'status',
      header: '',
      cell: ({ row }) =>
        row.original.mergedIntoId != null ? (
          <span className="badge">Объединена, с {row.original.validTo}</span>
        ) : row.original.validTo ? (
          <span className="badge">Закрыта с {row.original.validTo}</span>
        ) : null,
    },
  ]
}

const defaultValues: GroupFormValues = {
  name: '',
  specialityId: 0,
  admissionYear: new Date().getFullYear(),
  course: 1,
  studentsCount: 25,
  maxPairsPerDay: 6,
  maxHoursPerWeek: 45,
  funding: 'budget',
  validFrom: todayIso(),
}

function GroupFields({ control, specialities }: { control: Control<GroupFormValues>; specialities: Speciality[] }) {
  return (
    <>
      <TextField control={control} name="name" label="Название («31 СД»)" />
      <SelectField
        control={control}
        name="specialityId"
        label="Специальность"
        valueType="number"
        options={specialities.map((s) => ({ value: String(s.id), label: s.name }))}
      />
      <NumberField control={control} name="admissionYear" label="Год набора" min={2000} max={2100} />
      <NumberField control={control} name="course" label="Курс" min={1} max={4} />
      <NumberField control={control} name="studentsCount" label="Число студентов" min={1} />
      <NumberField control={control} name="maxPairsPerDay" label="Максимум пар в день" min={1} max={6} />
      <NumberField control={control} name="maxHoursPerWeek" label="Максимум часов в неделю" min={1} />
      <SelectField
        control={control}
        name="funding"
        label="Финансирование"
        options={[
          { value: 'budget', label: 'Бюджет' },
          { value: 'contract', label: 'Контракт' },
        ]}
      />
      <DateField control={control} name="validFrom" label="Действует с" />
    </>
  )
}

const actions: ReferenceCrudAction<StudyGroup>[] = [
  {
    key: 'close',
    labelRu: (row) => (row.validTo ? 'Открыть заново' : ruCommon.close),
    hidden: (row) => row.mergedIntoId != null,
    confirmTitleRu: (row) => (row.validTo ? 'Открыть группу заново?' : ruCommon.confirmCloseTitle),
    successRu: (row) => (row.validTo ? 'Открыта заново' : ruCommon.closedOk),
    run: (row) => api.invoke('groups:close', { id: row.id, rowVersion: row.rowVersion, validTo: row.validTo ? null : todayIso() }),
  },
  {
    key: 'delete',
    labelRu: () => ruCommon.delete,
    variant: 'danger',
    confirmTitleRu: (row) => `Удалить группу «${row.name}»?`,
    confirmBodyRu: () => ruCommon.confirmDeleteBody,
    confirmLabelRu: ruCommon.yesDelete,
    successRu: () => ruCommon.deletedOk,
    run: (row) => api.invoke('groups:delete', { id: row.id }),
  },
]

export function GroupsPage() {
  const [specialities, setSpecialities] = useState<Speciality[]>([])
  const [activeGroups, setActiveGroups] = useState<StudyGroup[]>([])
  const [mergeOpen, setMergeOpen] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    void api.invoke('specialities:list', {}).then((res) => {
      if (res.ok) setSpecialities(res.value)
    })
  }, [])

  useEffect(() => {
    void api.invoke('groups:list', { includeClosed: false }).then((res) => {
      if (res.ok) setActiveGroups(res.value)
    })
  }, [refreshToken])

  const specialityNameById = new Map(specialities.map((s) => [s.id, s.name]))

  return (
    <>
      <ReferenceCrudPage<StudyGroup, GroupFormValues>
        key={refreshToken}
        entityName="study_group"
        titleRu="Группы"
        createTitleRu="Новая группа"
        editTitleRu="Группа"
        columns={buildColumns(specialityNameById)}
        resolver={zodResolver(groupSaveInput)}
        defaultValues={{ ...defaultValues, specialityId: specialities[0]?.id ?? 0 }}
        toFormValues={(row) => ({
          name: row.name,
          specialityId: row.specialityId,
          admissionYear: row.admissionYear,
          course: row.course,
          studentsCount: row.studentsCount,
          maxPairsPerDay: row.maxPairsPerDay,
          maxHoursPerWeek: row.maxHoursPerWeek,
          funding: row.funding,
          validFrom: row.validFrom,
        })}
        renderFields={(control) => <GroupFields control={control} specialities={specialities} />}
        list={(includeClosed) => api.invoke('groups:list', { includeClosed })}
        save={(values) => api.invoke('groups:save', values)}
        actions={actions}
        hasArchivedFilter
        archivedFilterLabelRu="Показывать закрытые"
        rowClassName={(row) => (row.validTo ? 'archived-row' : '')}
        renderExtra={(row) => <SubgroupSchemesPanel group={row} />}
        toolbarExtra={
          <button className="btn" onClick={() => setMergeOpen(true)} disabled={activeGroups.length < 2}>
            Объединить группы…
          </button>
        }
      />
      {mergeOpen && (
        <MergeGroupsDialog
          groups={activeGroups}
          onClose={() => setMergeOpen(false)}
          onMerged={() => {
            setMergeOpen(false)
            setRefreshToken((t) => t + 1)
          }}
        />
      )}
    </>
  )
}
