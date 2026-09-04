import { asc, eq, isNull } from 'drizzle-orm'
import type { Discipline } from '../../shared/ipc/contract'
import { disciplineArchiveInput, disciplineDeleteInput, disciplineSaveInput, disciplinesListInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { nowIso } from '../db/repo/audit'
import { createRow, deleteRow, updateRow } from '../db/repo/base-repo'
import { ensureDeletable } from '../db/repo/reference-guard'
import { discipline } from '../db/schema'
import { curriculumRow } from '../db/schema/curriculum'
import { teacherQualification } from '../db/schema/people'
import { lesson } from '../db/schema/schedule'
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

  handle('disciplines:delete', disciplineDeleteInput, ({ id }) => {
    const existing = db.select().from(discipline).where(eq(discipline.id, id)).get()
    const label = `дисциплину «${existing?.name ?? id}»`
    db.transaction((tx) => {
      ensureDeletable(tx, label, id, [
        { table: curriculumRow, column: curriculumRow.disciplineId, nounRu: 'строках учебных планов' },
        { table: teacherQualification, column: teacherQualification.disciplineId, nounRu: 'квалификациях преподавателей' },
        { table: lesson, column: lesson.disciplineId, nounRu: 'занятиях' },
      ])
      deleteRow(tx, discipline, id, { reason: 'удаление дисциплины' })
    })
    return { ok: true as const }
  })
}
