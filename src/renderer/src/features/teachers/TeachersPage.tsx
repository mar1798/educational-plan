import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import { useEffect, useState } from 'react'
import type { Control } from 'react-hook-form'
import type { z } from 'zod'
import type { Cmc, Teacher, TeacherCategory } from '../../../../shared/ipc/contract'
import { teacherSaveInput } from '../../../../shared/ipc/schemas'
import { api } from '../../api/client'
import { DateField } from '../../ui/form/DateField'
import { NumberField } from '../../ui/form/NumberField'
import { SelectField } from '../../ui/form/SelectField'
import { TextField } from '../../ui/form/TextField'
import { ruCommon } from '../../ui/locale'
import { ReferenceCrudPage, type ReferenceCrudAction } from '../../ui/ReferenceCrudPage'
import { TeacherAbsencesPanel } from './TeacherAbsencesPanel'
import { TeacherQualificationsPanel } from './TeacherQualificationsPanel'
import { TeacherSubstitutionHistoryPanel } from './TeacherSubstitutionHistoryPanel'

type TeacherFormValues = z.infer<typeof teacherSaveInput>

function fullName(row: Teacher): string {
  return [row.lastName, row.firstName, row.middleName].filter(Boolean).join(' ')
}

function buildColumns(categoryNameById: Map<number, string>, cmcNameById: Map<number, string>): ColumnDef<Teacher>[] {
  return [
    { id: 'name', header: 'ФИО', accessorFn: fullName },
    { id: 'category', header: 'Категория', accessorFn: (row) => categoryNameById.get(row.categoryId) ?? row.categoryId },
    { id: 'cmc', header: 'ЦМК', accessorFn: (row) => (row.cmcId != null ? (cmcNameById.get(row.cmcId) ?? row.cmcId) : '—') },
    { accessorKey: 'rate', header: 'Ставка' },
    { accessorKey: 'phone', header: 'Телефон', cell: (info) => info.getValue() ?? '—' },
    {
      id: 'status',
      header: '',
      cell: ({ row }) => (row.original.firedAt ? <span className="badge">Уволен с {row.original.firedAt}</span> : null),
    },
  ]
}

const defaultValues: TeacherFormValues = {
  lastName: '',
  firstName: '',
  middleName: null,
  cmcId: null,
  categoryId: 0,
  rate: 1,
  maxHoursYear: null,
  maxPairsPerDay: null,
  phone: null,
  mainWorkplace: null,
  availabilityNote: null,
  hiredAt: null,
  firedAt: null,
  note: null,
}

const actions: ReferenceCrudAction<Teacher>[] = [
  {
    key: 'delete',
    labelRu: () => ruCommon.delete,
    variant: 'danger',
    confirmTitleRu: (row) => `Удалить преподавателя «${fullName(row)}»?`,
    confirmBodyRu: () => ruCommon.confirmDeleteBody,
    confirmLabelRu: ruCommon.yesDelete,
    successRu: () => ruCommon.deletedOk,
    run: (row) => api.invoke('teachers:delete', { id: row.id }),
  },
]

function TeacherFields({ control, categories, cmcList }: { control: Control<TeacherFormValues>; categories: TeacherCategory[]; cmcList: Cmc[] }) {
  return (
    <>
      <TextField control={control} name="lastName" label="Фамилия" />
      <TextField control={control} name="firstName" label="Имя" />
      <TextField control={control} name="middleName" label="Отчество" nullable />
      <SelectField
        control={control}
        name="categoryId"
        label="Категория"
        valueType="number"
        options={categories.map((c) => ({ value: String(c.id), label: c.titleRu }))}
      />
      <SelectField
        control={control}
        name="cmcId"
        label="ЦМК"
        valueType="number"
        nullable
        options={cmcList.map((c) => ({ value: String(c.id), label: c.name }))}
      />
      <NumberField control={control} name="rate" label="Ставка" min={0} />
      <NumberField control={control} name="maxHoursYear" label="Максимум часов в год" nullable min={1} />
      <NumberField control={control} name="maxPairsPerDay" label="Максимум пар в день" nullable min={1} max={6} />
      <TextField control={control} name="phone" label="Телефон" nullable />
      <TextField control={control} name="mainWorkplace" label="Основное место работы" nullable />
      <TextField control={control} name="availabilityNote" label="Заметка о доступности" nullable />
      <DateField control={control} name="hiredAt" label="Принят с" nullable />
      <DateField control={control} name="firedAt" label="Уволен с" nullable />
      <TextField control={control} name="note" label="Примечание" nullable />
    </>
  )
}

export function TeachersPage() {
  const [categories, setCategories] = useState<TeacherCategory[]>([])
  const [cmcList, setCmcList] = useState<Cmc[]>([])

  useEffect(() => {
    void api.invoke('teacherCategories:list', {}).then((res) => {
      if (res.ok) setCategories(res.value)
    })
    void api.invoke('cmc:list', {}).then((res) => {
      if (res.ok) setCmcList(res.value)
    })
  }, [])

  const categoryNameById = new Map(categories.map((c) => [c.id, c.titleRu]))
  const cmcNameById = new Map(cmcList.map((c) => [c.id, c.name]))

  return (
    <ReferenceCrudPage<Teacher, TeacherFormValues>
      entityName="teacher"
      titleRu="Преподаватели"
      createTitleRu="Новый преподаватель"
      editTitleRu="Преподаватель"
      columns={buildColumns(categoryNameById, cmcNameById)}
      resolver={zodResolver(teacherSaveInput)}
      defaultValues={{ ...defaultValues, categoryId: categories[0]?.id ?? 0 }}
      toFormValues={(row) => ({
        lastName: row.lastName,
        firstName: row.firstName,
        middleName: row.middleName,
        cmcId: row.cmcId,
        categoryId: row.categoryId,
        rate: row.rate,
        maxHoursYear: row.maxHoursYear,
        maxPairsPerDay: row.maxPairsPerDay,
        phone: row.phone,
        mainWorkplace: row.mainWorkplace,
        availabilityNote: row.availabilityNote,
        hiredAt: row.hiredAt,
        firedAt: row.firedAt,
        note: row.note,
      })}
      renderFields={(control) => <TeacherFields control={control} categories={categories} cmcList={cmcList} />}
      list={(includeFired) => api.invoke('teachers:list', { includeFired })}
      save={(values) => api.invoke('teachers:save', values)}
      actions={actions}
      hasArchivedFilter
      archivedFilterLabelRu="Показывать уволенных"
      rowClassName={(row) => (row.firedAt ? 'archived-row' : '')}
      renderExtra={(row) => (
        <>
          <TeacherQualificationsPanel teacherId={row.id} />
          <TeacherAbsencesPanel teacherId={row.id} />
          <TeacherSubstitutionHistoryPanel teacherId={row.id} />
        </>
      )}
    />
  )
}
