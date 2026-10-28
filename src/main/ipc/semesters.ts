import { asc, eq } from 'drizzle-orm'
import type { Semester } from '../../shared/ipc/contract'
import { semesterDeleteInput, semesterSaveInput, semestersListInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { createRow, deleteRow, updateRow } from '../db/repo/base-repo'
import { syncSemesterSchemes } from '../db/repo/division-scheme'
import { runOperation } from '../db/repo/operations'
import { ensureDeletable } from '../db/repo/reference-guard'
import { calendarDay, divisionScheme, semester } from '../db/schema'
import { teachingLoad } from '../db/schema/load'
import { handle } from './register'

export function registerSemestersHandlers(db: Db) {
  handle('semesters:list', semestersListInput, ({ academicYearId }) => {
    const rows =
      academicYearId != null
        ? db.select().from(semester).where(eq(semester.academicYearId, academicYearId)).orderBy(asc(semester.startsOn)).all()
        : db.select().from(semester).orderBy(asc(semester.startsOn)).all()
    return rows as unknown as Semester[]
  })

  handle('semesters:save', semesterSaveInput, ({ id, rowVersion, ...values }) => {
    if (id != null) return updateRow(db, semester, id, values, rowVersion!, { reason: 'правка семестра' }) as unknown as Semester
    // Новый семестр сразу получает клинические схемы всех групп (п. 44) — это массовая запись,
    // поэтому операция: откатывается одной кнопкой вместе с самим семестром.
    const { result } = runOperation(db, 'bulk_edit', { semester: values }, (tx, operationId) => {
      const row = createRow(tx, semester, values, { operationId, reason: 'создание семестра' })
      syncSemesterSchemes(tx, row.id as number, { operationId, reason: 'клинические подгруппы нового семестра' })
      return row
    })
    return result as unknown as Semester
  })

  handle('semesters:delete', semesterDeleteInput, ({ id }) => {
    const existing = db.select().from(semester).where(eq(semester.id, id)).get()
    const label = `Семестр #${existing?.no ?? id}`
    db.transaction((tx) => {
      ensureDeletable(tx, label, id, [
        { table: divisionScheme, column: divisionScheme.semesterId, nounRu: 'схемах деления' },
        { table: calendarDay, column: calendarDay.semesterId, nounRu: 'днях календаря' },
        { table: teachingLoad, column: teachingLoad.semesterId, nounRu: 'нагрузке' },
      ])
      deleteRow(tx, semester, id, { reason: 'удаление семестра' })
    })
    return { ok: true as const }
  })
}
