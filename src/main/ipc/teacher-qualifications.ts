import { asc, eq } from 'drizzle-orm'
import type { TeacherQualification } from '../../shared/ipc/contract'
import {
  teacherQualificationCloseInput,
  teacherQualificationCreateInput,
  teacherQualificationsListInput,
} from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { closeRow, createRow } from '../db/repo/base-repo'
import { countAffectedLoad } from '../db/repo/teaching-load-guard'
import { teacherQualification } from '../db/schema/people'
import { handle } from './register'

export function registerTeacherQualificationsHandlers(db: Db) {
  handle('teacherQualifications:list', teacherQualificationsListInput, ({ teacherId }) => {
    return db
      .select()
      .from(teacherQualification)
      .where(eq(teacherQualification.teacherId, teacherId))
      .orderBy(asc(teacherQualification.validFrom))
      .all() as unknown as TeacherQualification[]
  })

  handle('teacherQualifications:create', teacherQualificationCreateInput, (values) => {
    const row = createRow(db, teacherQualification, { ...values }, { reason: 'добавление квалификации' })
    return row as unknown as TeacherQualification
  })

  handle('teacherQualifications:close', teacherQualificationCloseInput, ({ id, rowVersion, validTo }) => {
    const before = db.select().from(teacherQualification).where(eq(teacherQualification.id, id)).get()
    closeRow(db, teacherQualification, id, validTo, rowVersion, { reason: 'закрытие квалификации' })

    if (!before) return { ok: true as const, affectedLoadCount: 0 }
    return { ok: true as const, affectedLoadCount: countAffectedLoad(db, before.teacherId, before.disciplineId) }
  })
}
