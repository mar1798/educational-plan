import { asc, eq } from 'drizzle-orm'
import type { Cmc } from '../../shared/ipc/contract'
import { cmcDeleteInput, cmcListInput, cmcSaveInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { createRow, deleteRow, updateRow } from '../db/repo/base-repo'
import { ensureDeletable } from '../db/repo/reference-guard'
import { cmc, teacher } from '../db/schema'
import { handle } from './register'

export function registerCmcHandlers(db: Db) {
  handle('cmc:list', cmcListInput, () => {
    return db.select().from(cmc).orderBy(asc(cmc.name)).all() as unknown as Cmc[]
  })

  handle('cmc:save', cmcSaveInput, ({ id, rowVersion, ...values }) => {
    const row =
      id != null
        ? updateRow(db, cmc, id, values, rowVersion!, { reason: 'правка ЦМК' })
        : createRow(db, cmc, values, { reason: 'создание ЦМК' })
    return row as unknown as Cmc
  })

  handle('cmc:delete', cmcDeleteInput, ({ id }) => {
    const existing = db.select().from(cmc).where(eq(cmc.id, id)).get()
    const label = `ЦМК «${existing?.name ?? id}»`
    db.transaction((tx) => {
      ensureDeletable(tx, label, id, [{ table: teacher, column: teacher.cmcId, nounRu: 'преподавателях' }])
      deleteRow(tx, cmc, id, { reason: 'удаление ЦМК' })
    })
    return { ok: true as const }
  })
}
