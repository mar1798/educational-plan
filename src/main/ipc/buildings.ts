import { asc, eq } from 'drizzle-orm'
import type { Building } from '../../shared/ipc/contract'
import { buildingDeleteInput, buildingSaveInput, buildingsListInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { createRow, deleteRow, updateRow } from '../db/repo/base-repo'
import { ensureDeletable } from '../db/repo/reference-guard'
import { building, room } from '../db/schema'
import { handle } from './register'

export function registerBuildingsHandlers(db: Db) {
  handle('buildings:list', buildingsListInput, () => {
    return db.select().from(building).orderBy(asc(building.name)).all() as unknown as Building[]
  })

  handle('buildings:save', buildingSaveInput, ({ id, rowVersion, ...values }) => {
    const row =
      id != null
        ? updateRow(db, building, id, values, rowVersion!, { reason: 'правка корпуса' })
        : createRow(db, building, values, { reason: 'создание корпуса' })
    return row as unknown as Building
  })

  handle('buildings:delete', buildingDeleteInput, ({ id }) => {
    const existing = db.select().from(building).where(eq(building.id, id)).get()
    const label = `Корпус «${existing?.name ?? id}»`
    db.transaction((tx) => {
      ensureDeletable(tx, label, id, [{ table: room, column: room.buildingId, nounRu: 'кабинетах' }])
      deleteRow(tx, building, id, { reason: 'удаление корпуса' })
    })
    return { ok: true as const }
  })
}
