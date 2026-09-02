import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import { useEffect, useState } from 'react'
import type { Control } from 'react-hook-form'
import type { z } from 'zod'
import type { Building, Room } from '../../../../shared/ipc/contract'
import { roomSaveInput } from '../../../../shared/ipc/schemas'
import { api } from '../../api/client'
import { NumberField } from '../../ui/form/NumberField'
import { SelectField } from '../../ui/form/SelectField'
import { TextField } from '../../ui/form/TextField'
import { DateField } from '../../ui/form/DateField'
import { ROOM_TYPE_LABEL, ruCommon } from '../../ui/locale'
import { ReferenceCrudPage, type ReferenceCrudAction } from '../../ui/ReferenceCrudPage'

type RoomFormValues = z.infer<typeof roomSaveInput>

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function buildColumns(buildingNameById: Map<number, string>): ColumnDef<Room>[] {
  return [
    { accessorKey: 'number', header: 'Номер' },
    { accessorKey: 'name', header: 'Название', cell: (info) => info.getValue() ?? '—' },
    {
      id: 'building',
      header: 'Корпус',
      accessorFn: (row) => buildingNameById.get(row.buildingId) ?? row.buildingId,
    },
    { id: 'roomType', header: 'Тип', accessorFn: (row) => ROOM_TYPE_LABEL[row.roomType] },
    { accessorKey: 'capacity', header: 'Вместимость', cell: (info) => info.getValue() ?? '—' },
    {
      id: 'status',
      header: '',
      cell: ({ row }) => (row.original.validTo ? <span className="badge">Закрыт с {row.original.validTo}</span> : null),
    },
  ]
}

const actions: ReferenceCrudAction<Room>[] = [
  {
    key: 'close',
    labelRu: (row) => (row.validTo ? 'Открыть заново' : ruCommon.close),
    confirmTitleRu: (row) => (row.validTo ? 'Открыть кабинет заново?' : ruCommon.confirmCloseTitle),
    successRu: (row) => (row.validTo ? 'Открыт заново' : ruCommon.closedOk),
    run: (row) => api.invoke('rooms:close', { id: row.id, rowVersion: row.rowVersion, validTo: row.validTo ? null : todayIso() }),
  },
  {
    key: 'delete',
    labelRu: () => ruCommon.delete,
    variant: 'danger',
    confirmTitleRu: (row) => `Удалить кабинет ${row.number}?`,
    confirmBodyRu: () => ruCommon.confirmDeleteBody,
    confirmLabelRu: ruCommon.yesDelete,
    successRu: () => ruCommon.deletedOk,
    run: (row) => api.invoke('rooms:delete', { id: row.id }),
  },
]

function RoomFields({ control, buildings }: { control: Control<RoomFormValues>; buildings: Building[] }) {
  return (
    <>
      <SelectField
        control={control}
        name="buildingId"
        label="Корпус"
        valueType="number"
        options={buildings.map((b) => ({ value: String(b.id), label: b.name }))}
      />
      <TextField control={control} name="number" label="Номер кабинета" />
      <TextField control={control} name="name" label="Название" nullable />
      <SelectField
        control={control}
        name="roomType"
        label="Тип кабинета"
        options={Object.entries(ROOM_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
      />
      <NumberField control={control} name="capacity" label="Вместимость" nullable min={1} />
      <DateField control={control} name="validFrom" label="Действует с" />
    </>
  )
}

export function RoomsPage() {
  const [buildings, setBuildings] = useState<Building[]>([])

  useEffect(() => {
    void api.invoke('buildings:list', {}).then((res) => {
      if (res.ok) setBuildings(res.value)
    })
  }, [])

  const buildingNameById = new Map(buildings.map((b) => [b.id, b.name]))
  const defaultValues: RoomFormValues = {
    buildingId: buildings[0]?.id ?? 0,
    number: '',
    name: null,
    capacity: null,
    roomType: 'practice',
    validFrom: todayIso(),
  }

  return (
    <ReferenceCrudPage<Room, RoomFormValues>
      entityName="room"
      titleRu="Кабинеты"
      createTitleRu="Новый кабинет"
      editTitleRu="Кабинет"
      columns={buildColumns(buildingNameById)}
      resolver={zodResolver(roomSaveInput)}
      defaultValues={defaultValues}
      toFormValues={(row) => ({
        buildingId: row.buildingId,
        number: row.number,
        name: row.name,
        capacity: row.capacity,
        roomType: row.roomType,
        validFrom: row.validFrom,
      })}
      renderFields={(control) => <RoomFields control={control} buildings={buildings} />}
      list={(includeArchived) => api.invoke('rooms:list', { includeClosed: includeArchived })}
      save={(values) => api.invoke('rooms:save', values)}
      actions={actions}
      hasArchivedFilter
      archivedFilterLabelRu="Показывать закрытые"
      rowClassName={(row) => (row.validTo ? 'archived-row' : '')}
    />
  )
}
