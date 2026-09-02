import { asc, eq, isNull } from 'drizzle-orm'
import type { Teacher } from '../../shared/ipc/contract'
import { teacherDeleteInput, teacherSaveInput, teachersListInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { createRow, deleteRow, updateRow } from '../db/repo/base-repo'
import { ensureDeletable } from '../db/repo/reference-guard'
import { room } from '../db/schema/org'
import { cmc, teacher, teacherAbsence, teacherQualification } from '../db/schema/people'
import { lesson, substitution } from '../db/schema/schedule'
import { teachingLoad } from '../db/schema/load'
import { otherLoad } from '../db/schema/system'
import { handle } from './register'

export function registerTeachersHandlers(db: Db) {
  handle('teachers:list', teachersListInput, ({ includeFired }) => {
    const rows = includeFired
      ? db.select().from(teacher).orderBy(asc(teacher.lastName), asc(teacher.firstName)).all()
      : db
          .select()
          .from(teacher)
          .where(isNull(teacher.firedAt))
          .orderBy(asc(teacher.lastName), asc(teacher.firstName))
          .all()
    return rows as unknown as Teacher[]
  })

  handle('teachers:save', teacherSaveInput, ({ id, rowVersion, ...values }) => {
    const row =
      id != null
        ? updateRow(db, teacher, id, values, rowVersion!, { reason: 'правка преподавателя' })
        : createRow(db, teacher, values, { reason: 'создание преподавателя' })
    return row as unknown as Teacher
  })

  handle('teachers:delete', teacherDeleteInput, ({ id }) => {
    const existing = db.select().from(teacher).where(eq(teacher.id, id)).get()
    const label = `Преподаватель «${existing ? `${existing.lastName} ${existing.firstName}` : id}»`
    db.transaction((tx) => {
      ensureDeletable(tx, label, id, [
        { table: teacherQualification, column: teacherQualification.teacherId, nounRu: 'квалификациях' },
        { table: teacherAbsence, column: teacherAbsence.teacherId, nounRu: 'записях недоступности' },
        { table: teachingLoad, column: teachingLoad.teacherId, nounRu: 'строках нагрузки' },
        { table: otherLoad, column: otherLoad.teacherId, nounRu: 'прочих часах' },
        { table: lesson, column: lesson.teacherId, nounRu: 'занятиях' },
        { table: cmc, column: cmc.headTeacherId, nounRu: 'ЦМК (как председатель)' },
        { table: room, column: room.pinnedTeacherId, nounRu: 'закреплённых кабинетах' },
      ])
      // substitution ссылается на преподавателя двумя колонками — считаем как одну проверку.
      ensureDeletable(tx, label, id, [{ table: substitution, column: substitution.originalTeacherId, nounRu: 'заменах' }])
      ensureDeletable(tx, label, id, [{ table: substitution, column: substitution.substituteTeacherId, nounRu: 'заменах' }])
      deleteRow(tx, teacher, id, { reason: 'удаление преподавателя' })
    })
    return { ok: true as const }
  })
}
