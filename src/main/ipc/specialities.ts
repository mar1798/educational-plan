import { asc, isNull } from 'drizzle-orm'
import type { Speciality } from '../../shared/ipc/contract'
import { specialitiesListInput, specialityArchiveInput, specialitySaveInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { nowIso } from '../db/repo/audit'
import { createRow, updateRow } from '../db/repo/base-repo'
import { speciality } from '../db/schema'
import { handle } from './register'

export function registerSpecialitiesHandlers(db: Db) {
  handle('specialities:list', specialitiesListInput, ({ includeArchived }) => {
    const rows = includeArchived
      ? db.select().from(speciality).orderBy(asc(speciality.name)).all()
      : db.select().from(speciality).where(isNull(speciality.archivedAt)).orderBy(asc(speciality.name)).all()
    return rows as unknown as Speciality[]
  })

  handle('specialities:save', specialitySaveInput, ({ id, rowVersion, ...values }) => {
    const row =
      id != null
        ? updateRow(db, speciality, id, values, rowVersion!, { reason: 'правка справочника специальностей' })
        : createRow(db, speciality, values, { reason: 'создание специальности' })
    return row as unknown as Speciality
  })

  handle('specialities:archive', specialityArchiveInput, ({ id, rowVersion, archived }) => {
    updateRow(
      db,
      speciality,
      id,
      { archivedAt: archived ? nowIso() : null },
      rowVersion,
      { reason: archived ? 'архивация специальности' : 'восстановление специальности из архива' },
    )
    return { ok: true as const }
  })
}
