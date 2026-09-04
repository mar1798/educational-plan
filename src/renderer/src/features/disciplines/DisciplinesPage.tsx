import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import type { z } from 'zod'
import type { Discipline } from '../../../../shared/ipc/contract'
import { disciplineSaveInput } from '../../../../shared/ipc/schemas'
import { api } from '../../api/client'
import { CheckboxField } from '../../ui/form/CheckboxField'
import { NumberField } from '../../ui/form/NumberField'
import { SelectField } from '../../ui/form/SelectField'
import { TextField } from '../../ui/form/TextField'
import { ROOM_TYPE_LABEL, ruCommon } from '../../ui/locale'
import { ReferenceCrudPage, type ReferenceCrudAction } from '../../ui/ReferenceCrudPage'

type DisciplineFormValues = z.infer<typeof disciplineSaveInput>

const CYCLE_LABEL: Record<Discipline['cycle'], string> = {
  spo1: 'СПО.1',
  spo2: 'СПО.2',
  spo3: 'СПО.3',
  spo4: 'СПО.4',
  spo5: 'СПО.5',
}

const PART_LABEL: Record<Discipline['part'], string> = {
  base: 'Базовая',
  elective: 'Элективная',
}

const columns: ColumnDef<Discipline>[] = [
  { accessorKey: 'name', header: 'Название' },
  { accessorKey: 'indexCode', header: 'Индекс', cell: (info) => info.getValue() ?? '—' },
  { id: 'block', header: 'Блок', accessorFn: (row) => row.block },
  { id: 'cycle', header: 'Цикл', accessorFn: (row) => CYCLE_LABEL[row.cycle] },
  { id: 'part', header: 'Часть', accessorFn: (row) => PART_LABEL[row.part] },
  { accessorKey: 'difficulty', header: 'Сложность' },
  {
    id: 'status',
    header: '',
    cell: ({ row }) => (row.original.archivedAt ? <span className="badge">В архиве</span> : null),
  },
]

const defaultValues: DisciplineFormValues = {
  name: '',
  indexCode: null,
  block: 1,
  cycle: 'spo3',
  part: 'base',
  difficulty: 1,
  defaultRoomType: null,
  requiresClinical: false,
}

const actions: ReferenceCrudAction<Discipline>[] = [
  {
    key: 'archive',
    labelRu: (row) => (row.archivedAt ? ruCommon.restore : ruCommon.archive),
    confirmTitleRu: (row) => (row.archivedAt ? 'Восстановить дисциплину из архива?' : 'Архивировать дисциплину?'),
    successRu: (row) => (row.archivedAt ? ruCommon.restoredOk : ruCommon.archivedOk),
    run: (row) => api.invoke('disciplines:archive', { id: row.id, rowVersion: row.rowVersion, archived: !row.archivedAt }),
  },
  {
    key: 'delete',
    labelRu: () => ruCommon.delete,
    variant: 'danger',
    confirmTitleRu: (row) => `Удалить «${row.name}»?`,
    confirmBodyRu: () => 'Действие необратимо. Дисциплину, попавшую в планы, нагрузку или занятия, удалить нельзя — её можно только архивировать.',
    confirmLabelRu: ruCommon.yesDelete,
    successRu: () => ruCommon.deletedOk,
    run: (row) => api.invoke('disciplines:delete', { id: row.id }),
  },
]

export function DisciplinesPage() {
  return (
    <ReferenceCrudPage<Discipline, DisciplineFormValues>
      entityName="discipline"
      titleRu="Дисциплины"
      createTitleRu="Новая дисциплина"
      editTitleRu="Дисциплина"
      columns={columns}
      // Порядок как в учебном плане (§2.7): блок → цикл → базовые перед элективными → название.
      initialSorting={[
        { id: 'block', desc: false },
        { id: 'cycle', desc: false },
        { id: 'part', desc: false },
        { id: 'name', desc: false },
      ]}
      groupHeader={(row) => `Блок ${row.block} · ${CYCLE_LABEL[row.cycle]}`}
      resolver={zodResolver(disciplineSaveInput)}
      defaultValues={defaultValues}
      toFormValues={(row) => ({
        name: row.name,
        indexCode: row.indexCode,
        block: row.block,
        cycle: row.cycle,
        part: row.part,
        difficulty: row.difficulty,
        defaultRoomType: row.defaultRoomType,
        requiresClinical: row.requiresClinical,
      })}
      renderFields={(control) => (
        <>
          <TextField control={control} name="name" label="Название дисциплины" />
          <TextField control={control} name="indexCode" label="Индекс по плану" nullable />
          <SelectField
            control={control}
            name="block"
            label="Блок"
            valueType="number"
            options={[1, 2, 3].map((b) => ({ value: String(b), label: String(b) }))}
          />
          <SelectField
            control={control}
            name="cycle"
            label="Цикл"
            options={Object.entries(CYCLE_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <SelectField
            control={control}
            name="part"
            label="Часть"
            options={Object.entries(PART_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <NumberField control={control} name="difficulty" label="Сложность (1–5)" min={1} max={5} />
          <SelectField
            control={control}
            name="defaultRoomType"
            label="Кабинет по умолчанию"
            nullable
            options={Object.entries(ROOM_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <CheckboxField control={control} name="requiresClinical" label="Требует клиническую базу" />
        </>
      )}
      list={(includeArchived) => api.invoke('disciplines:list', { includeArchived })}
      save={(values) => api.invoke('disciplines:save', values)}
      actions={actions}
      hasArchivedFilter
      rowClassName={(row) => (row.archivedAt ? 'archived-row' : '')}
    />
  )
}
