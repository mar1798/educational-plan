import { asc, eq, isNull } from 'drizzle-orm'
import type { GroupMergePreview, StudyGroup } from '../../shared/ipc/contract'
import {
  groupCloseInput,
  groupDeleteInput,
  groupMergeInput,
  groupMergePreviewInput,
  groupSaveInput,
  groupsListInput,
} from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { closeRow, createRow, deleteRow, updateRow } from '../db/repo/base-repo'
import { countActiveGroupRefs, reassignActiveGroupRefs } from '../db/repo/group-merge'
import { streamMember, teachingLoad } from '../db/schema/load'
import { runOperation } from '../db/repo/operations'
import { ensureDeletable } from '../db/repo/reference-guard'
import { divisionScheme, studyGroup } from '../db/schema/people'
import { lessonGroup } from '../db/schema/schedule'
import { handle } from './register'

export function registerGroupsHandlers(db: Db) {
  handle('groups:list', groupsListInput, ({ includeClosed }) => {
    const rows = includeClosed
      ? db.select().from(studyGroup).orderBy(asc(studyGroup.name)).all()
      : db
          .select()
          .from(studyGroup)
          .where(isNull(studyGroup.validTo))
          .orderBy(asc(studyGroup.name))
          .all()
    return rows as unknown as StudyGroup[]
  })

  handle('groups:save', groupSaveInput, ({ id, rowVersion, ...values }) => {
    const row =
      id != null
        ? updateRow(db, studyGroup, id, values, rowVersion!, { reason: 'правка группы' })
        : createRow(db, studyGroup, values, { reason: 'создание группы' })
    return row as unknown as StudyGroup
  })

  handle('groups:close', groupCloseInput, ({ id, rowVersion, validTo }) => {
    if (validTo == null) {
      // Симметрично кабинету: снятие valid_to «открывает» группу заново.
      updateRow(db, studyGroup, id, { validTo: null }, rowVersion, { reason: 'открытие группы заново' })
    } else {
      closeRow(db, studyGroup, id, validTo, rowVersion, { reason: 'закрытие группы' })
    }
    return { ok: true as const }
  })

  handle('groups:delete', groupDeleteInput, ({ id }) => {
    const existing = db.select().from(studyGroup).where(eq(studyGroup.id, id)).get()
    const label = `Группа «${existing?.name ?? id}»`
    db.transaction((tx) => {
      ensureDeletable(tx, label, id, [
        { table: divisionScheme, column: divisionScheme.groupId, nounRu: 'схемах деления' },
        { table: streamMember, column: streamMember.groupId, nounRu: 'потоках' },
        { table: teachingLoad, column: teachingLoad.groupId, nounRu: 'нагрузке' },
        { table: lessonGroup, column: lessonGroup.groupId, nounRu: 'занятиях' },
        { table: studyGroup, column: studyGroup.mergedIntoId, nounRu: 'объединённых с ней группах' },
      ])
      deleteRow(tx, studyGroup, id, { reason: 'удаление группы' })
    })
    return { ok: true as const }
  })

  handle('groups:mergePreview', groupMergePreviewInput, ({ sourceGroupId, targetGroupId, mergeDate }) => {
    const source = db.select().from(studyGroup).where(eq(studyGroup.id, sourceGroupId)).get()
    const target = db.select().from(studyGroup).where(eq(studyGroup.id, targetGroupId)).get()
    if (!source) throw new Error(`Группа #${sourceGroupId} не найдена`)
    if (!target) throw new Error(`Группа #${targetGroupId} не найдена`)
    const counts = countActiveGroupRefs(db, sourceGroupId, mergeDate)
    const preview: GroupMergePreview = {
      sourceGroupName: source.name,
      targetGroupName: target.name,
      affectedTeachingLoad: counts.teachingLoad,
      affectedStreamMembers: counts.streamMember,
    }
    return preview
  })

  handle('groups:merge', groupMergeInput, ({ sourceGroupId, targetGroupId, mergeDate }) => {
    if (sourceGroupId === targetGroupId) throw new Error('Нельзя объединить группу саму с собой')

    const { operationId } = runOperation(
      db,
      'bulk_edit',
      { sourceGroupId, targetGroupId, mergeDate },
      (tx) => {
        const source = tx.select().from(studyGroup).where(eq(studyGroup.id, sourceGroupId)).get()
        const target = tx.select().from(studyGroup).where(eq(studyGroup.id, targetGroupId)).get()
        if (!source) throw new Error(`Группа #${sourceGroupId} не найдена`)
        if (!target) throw new Error(`Группа #${targetGroupId} не найдена`)
        if (source.mergedIntoId != null) throw new Error(`Группа «${source.name}» уже объединена с другой группой`)
        if (target.mergedIntoId != null) {
          throw new Error(`Группа «${target.name}» сама объединена с другой группой — выберите другую целевую группу`)
        }
        if (target.validTo != null) throw new Error(`Группа «${target.name}» закрыта — выберите другую целевую группу`)

        const ctx = { operationId, reason: `объединение группы «${source.name}» в «${target.name}»` }
        reassignActiveGroupRefs(tx, sourceGroupId, targetGroupId, mergeDate, ctx)
        updateRow(tx, studyGroup, sourceGroupId, { validTo: mergeDate, mergedIntoId: targetGroupId }, source.rowVersion, ctx, 'close')
      },
    )
    return { operationId }
  })
}
