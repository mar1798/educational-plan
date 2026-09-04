import { asc, eq, isNull } from 'drizzle-orm'
import type { Speciality } from '../../shared/ipc/contract'
import { specialitiesListInput, specialityArchiveInput, specialityDeleteInput, specialitySaveInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { nowIso } from '../db/repo/audit'
import { createRow, deleteRow, updateRow } from '../db/repo/base-repo'
import { ensureDeletable } from '../db/repo/reference-guard'
import { speciality } from '../db/schema'
import { calendarPeriod } from '../db/schema/calendar'
import { curriculum } from '../db/schema/curriculum'
import { studyGroup } from '../db/schema/people'
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

  // Архивация прячет специальность из списков, но не освобождает справочник от опечаток
  // и пробных записей — их нужно удалять физически (§2.2), пока на них никто не сослался.
  handle('specialities:delete', specialityDeleteInput, ({ id }) => {
    const existing = db.select().from(speciality).where(eq(speciality.id, id)).get()
    const label = `специальность «${existing?.name ?? id}»`
    db.transaction((tx) => {
      ensureDeletable(tx, label, id, [
        { table: curriculum, column: curriculum.specialityId, nounRu: 'учебных планах' },
        { table: studyGroup, column: studyGroup.specialityId, nounRu: 'группах' },
        { table: calendarPeriod, column: calendarPeriod.specialityId, nounRu: 'периодах календаря' },
      ])
      deleteRow(tx, speciality, id, { reason: 'удаление специальности' })
    })
    return { ok: true as const }
  })
}
