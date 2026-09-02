import { asc, eq } from 'drizzle-orm'
import type { TeacherAbsence } from '../../shared/ipc/contract'
import { teacherAbsenceCreateInput, teacherAbsenceDeleteInput, teacherAbsencesListInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { createRow, deleteRow } from '../db/repo/base-repo'
import { teacherAbsence } from '../db/schema/people'
import { handle } from './register'

export function registerTeacherAbsencesHandlers(db: Db) {
  handle('teacherAbsences:list', teacherAbsencesListInput, ({ teacherId }) => {
    return db
      .select()
      .from(teacherAbsence)
      .where(eq(teacherAbsence.teacherId, teacherId))
      .orderBy(asc(teacherAbsence.id))
      .all() as unknown as TeacherAbsence[]
  })

  handle('teacherAbsences:create', teacherAbsenceCreateInput, (values) => {
    const row = createRow(db, teacherAbsence, { ...values }, { reason: 'добавление недоступности' })
    return row as unknown as TeacherAbsence
  })

  handle('teacherAbsences:delete', teacherAbsenceDeleteInput, ({ id }) => {
    deleteRow(db, teacherAbsence, id, { reason: 'удаление записи недоступности' })
    return { ok: true as const }
  })
}
