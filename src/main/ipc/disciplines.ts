import { asc, isNull } from 'drizzle-orm'
import type { Discipline } from '../../shared/ipc/contract'
import { disciplineArchiveInput, disciplineSaveInput, disciplinesListInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { nowIso } from '../db/repo/audit'
import { createRow, updateRow } from '../db/repo/base-repo'
import { discipline } from '../db/schema'
import { handle } from './register'

export function registerDisciplinesHandlers(db: Db) {
  handle('disciplines:list', disciplinesListInput, ({ includeArchived }) => {
    const rows = includeArchived
      ? db.select().from(discipline).orderBy(asc(discipline.block), asc(discipline.cycle), asc(discipline.name)).all()
      : db
          .select()
          .from(discipline)
          .where(isNull(discipline.archivedAt))
          .orderBy(asc(discipline.block), asc(discipline.cycle), asc(discipline.name))
          .all()
    return rows as unknown as Discipline[]
  })

  handle('disciplines:save', disciplineSaveInput, ({ id, rowVersion, ...values }) => {
    const row =
      id != null
        ? updateRow(db, discipline, id, values, rowVersion!, { reason: 'правка дисциплины' })
        : createRow(db, discipline, values, { reason: 'создание дисциплины' })
    return row as unknown as Discipline
  })

  handle('disciplines:archive', disciplineArchiveInput, ({ id, rowVersion, archived }) => {
    updateRow(
      db,
      discipline,
      id,
      { archivedAt: archived ? nowIso() : null },
      rowVersion,
      { reason: archived ? 'архивация дисциплины' : 'восстановление дисциплины из архива' },
    )
    return { ok: true as const }
  })
}
