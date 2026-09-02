import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Room } from '../../shared/ipc/contract'
import { roomCloseInput, roomDeleteInput, roomSaveInput, roomsListInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { closeRow, createRow, deleteRow, updateRow } from '../db/repo/base-repo'
import { ensureDeletable } from '../db/repo/reference-guard'
import { room } from '../db/schema/org'
import { lesson, substitution, templateEntry } from '../db/schema/schedule'
import { handle } from './register'

export function registerRoomsHandlers(db: Db) {
  handle('rooms:list', roomsListInput, ({ buildingId, includeClosed }) => {
    const conditions = []
    if (buildingId != null) conditions.push(eq(room.buildingId, buildingId))
    if (!includeClosed) conditions.push(isNull(room.validTo))
    const rows = conditions.length
      ? db
          .select()
          .from(room)
          .where(and(...conditions))
          .orderBy(asc(room.number))
          .all()
      : db.select().from(room).orderBy(asc(room.number)).all()
    return rows as unknown as Room[]
  })

  handle('rooms:save', roomSaveInput, ({ id, rowVersion, ...values }) => {
    const row =
      id != null
        ? updateRow(db, room, id, values, rowVersion!, { reason: 'правка кабинета' })
        : createRow(db, room, values, { reason: 'создание кабинета' })
    return row as unknown as Room
  })

  handle('rooms:close', roomCloseInput, ({ id, rowVersion, validTo }) => {
    if (validTo == null) {
      // Симметрично архивации специальности: снятие valid_to «открывает» кабинет заново.
      updateRow(db, room, id, { validTo: null }, rowVersion, { reason: 'открытие кабинета заново' })
    } else {
      closeRow(db, room, id, validTo, rowVersion, { reason: 'закрытие кабинета' })
    }
    return { ok: true as const }
  })

  handle('rooms:delete', roomDeleteInput, ({ id }) => {
    const existing = db.select().from(room).where(eq(room.id, id)).get()
    const label = `Кабинет ${existing?.number ?? id}`
    db.transaction((tx) => {
      ensureDeletable(tx, label, id, [
        { table: lesson, column: lesson.roomId, nounRu: 'занятиях' },
        { table: templateEntry, column: templateEntry.roomId, nounRu: 'записях шаблона' },
      ])
      // substitution ссылается на кабинет двумя колонками — считаем как две проверки.
      ensureDeletable(tx, label, id, [{ table: substitution, column: substitution.originalRoomId, nounRu: 'заменах' }])
      ensureDeletable(tx, label, id, [{ table: substitution, column: substitution.newRoomId, nounRu: 'заменах' }])
      deleteRow(tx, room, id, { reason: 'удаление кабинета' })
    })
    return { ok: true as const }
  })
}
