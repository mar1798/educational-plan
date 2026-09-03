import { eq } from 'drizzle-orm'
import type {
  GroupBalanceRow,
  OtherLoad,
  StreamWithMembers,
  TeacherBalanceRow,
  TeachingLoad,
  TeachingLoadSaveResult,
} from '../../shared/ipc/contract'
import {
  loadBalanceByGroupInput,
  loadBalanceByTeacherInput,
  otherLoadDeleteInput,
  otherLoadListInput,
  otherLoadSaveInput,
  streamCreateInput,
  streamDisbandInput,
  streamsListForSemesterInput,
  teachingLoadDeleteInput,
  teachingLoadListInput,
  teachingLoadSaveInput,
} from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { createRow, deleteRow, updateRow } from '../db/repo/base-repo'
import { ensureDeletable } from '../db/repo/reference-guard'
import { runOperation } from '../db/repo/operations'
import { createStream, disbandStream, listStreamsWithMembers } from '../db/repo/stream'
import { loadBalanceByGroup, loadBalanceByTeacher, saveTeachingLoad } from '../db/repo/teaching-load'
import { teachingLoad } from '../db/schema/load'
import { otherLoad } from '../db/schema/system'
import { lesson, templateEntry } from '../db/schema/schedule'
import { handle } from './register'

export function registerTeachingLoadHandlers(db: Db) {
  handle('teachingLoad:list', teachingLoadListInput, ({ semesterId }) => {
    const rows = db.select().from(teachingLoad).where(eq(teachingLoad.semesterId, semesterId)).all()
    return rows as unknown as TeachingLoad[]
  })

  handle('teachingLoad:save', teachingLoadSaveInput, ({ id, rowVersion, validFrom, ...fields }) => {
    const result = db.transaction((tx) =>
      saveTeachingLoad(
        tx,
        fields,
        validFrom,
        id != null ? { id, rowVersion: rowVersion! } : null,
        { reason: id != null ? 'правка строки нагрузки' : 'назначение нагрузки' },
      ),
    )
    return { row: result.row, teacherHoursOverYear: result.teacherHoursOverYear } as unknown as TeachingLoadSaveResult
  })

  handle('teachingLoad:delete', teachingLoadDeleteInput, ({ id }) => {
    db.transaction((tx) => {
      ensureDeletable(tx, `Строка нагрузки #${id}`, id, [
        { table: lesson, column: lesson.teachingLoadId, nounRu: 'занятиях' },
        { table: templateEntry, column: templateEntry.teachingLoadId, nounRu: 'шаблоне расписания' },
      ])
      deleteRow(tx, teachingLoad, id, { reason: 'удаление строки нагрузки' })
    })
    return { ok: true as const }
  })

  handle('streams:listForSemester', streamsListForSemesterInput, ({ semesterId }) => {
    return listStreamsWithMembers(db, semesterId) as unknown as StreamWithMembers[]
  })

  handle('streams:create', streamCreateInput, ({ semesterId, name, groupIds, validFrom }) => {
    const created = db.transaction((tx) =>
      createStream(tx, { semesterId, name, groupIds, validFrom }, { reason: 'создание потока' }),
    )
    return created as unknown as StreamWithMembers
  })

  handle('streams:disband', streamDisbandInput, ({ id }) => {
    const { result } = runOperation(db, 'bulk_edit', { streamId: id }, (tx, operationId) =>
      disbandStream(tx, id, { operationId, reason: 'расформирование потока' }),
    )
    return result
  })

  handle('otherLoad:list', otherLoadListInput, ({ semesterId }) => {
    const rows = db.select().from(otherLoad).where(eq(otherLoad.semesterId, semesterId)).all()
    return rows as unknown as OtherLoad[]
  })

  handle('otherLoad:save', otherLoadSaveInput, ({ id, rowVersion, ...values }) => {
    const row =
      id != null
        ? updateRow(db, otherLoad, id, values, rowVersion!, { reason: 'правка прочих часов' })
        : createRow(db, otherLoad, values, { reason: 'добавление прочих часов' })
    return row as unknown as OtherLoad
  })

  handle('otherLoad:delete', otherLoadDeleteInput, ({ id }) => {
    deleteRow(db, otherLoad, id, { reason: 'удаление прочих часов' })
    return { ok: true as const }
  })

  handle('loadBalance:byGroup', loadBalanceByGroupInput, ({ semesterId }) => {
    return loadBalanceByGroup(db, semesterId) as unknown as GroupBalanceRow[]
  })

  handle('loadBalance:byTeacher', loadBalanceByTeacherInput, ({ semesterId }) => {
    return loadBalanceByTeacher(db, semesterId) as unknown as TeacherBalanceRow[]
  })
}
