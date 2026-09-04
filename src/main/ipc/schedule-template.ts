import type { RolloutApplyResult, RolloutPreview, ScheduleConflictView, ScheduleTemplate, TemplateEntryView, UnassignedLoadRow } from '../../shared/ipc/contract'
import {
  moveEntryInput,
  placeEntryInput,
  removeEntryInput,
  rolloutRangeInput,
  scheduleConflictsInput,
  scheduleTemplateActivateInput,
  scheduleTemplateArchiveInput,
  scheduleTemplateCreateInput,
  scheduleTemplateDeleteInput,
  scheduleTemplateEntriesInput,
  scheduleTemplateUnassignedLoadInput,
  scheduleTemplatesListInput,
  setEntryLockedInput,
} from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { runOperation } from '../db/repo/operations'
import {
  activateTemplate,
  applyRollout,
  archiveTemplate,
  createTemplate,
  deleteTemplate,
  listLessonConflicts,
  listTemplates,
  moveEntry,
  placeEntry,
  planRollout,
  removeEntry,
  setEntryLocked,
  templateEntriesView,
  unassignedLoadForTemplate,
} from '../db/repo/schedule-template'
import { handle } from './register'

export function registerScheduleTemplateHandlers(db: Db) {
  handle('scheduleTemplates:list', scheduleTemplatesListInput, ({ semesterId }) => {
    return listTemplates(db, semesterId) as unknown as ScheduleTemplate[]
  })

  handle('scheduleTemplates:create', scheduleTemplateCreateInput, (input) => {
    const created = db.transaction((tx) => createTemplate(tx, input, { reason: 'создание версии шаблона' }))
    return created as unknown as ScheduleTemplate
  })

  handle('scheduleTemplates:activate', scheduleTemplateActivateInput, ({ id, rowVersion }) => {
    db.transaction((tx) => activateTemplate(tx, id, rowVersion, { reason: 'активация версии шаблона' }))
    return { ok: true as const }
  })

  handle('scheduleTemplates:archive', scheduleTemplateArchiveInput, ({ id, rowVersion }) => {
    db.transaction((tx) => archiveTemplate(tx, id, rowVersion, { reason: 'архивирование версии шаблона' }))
    return { ok: true as const }
  })

  handle('scheduleTemplates:delete', scheduleTemplateDeleteInput, ({ id, rowVersion }) => {
    // Внутри операции (§1.5): удаляется вся сетка версии разом, и откат возвращает её целиком.
    const { operationId } = runOperation(db, 'bulk_edit', { id }, (tx, opId) =>
      deleteTemplate(tx, id, rowVersion, { operationId: opId, reason: 'удаление версии шаблона' }),
    )
    return { operationId }
  })

  handle('scheduleTemplates:entries', scheduleTemplateEntriesInput, ({ templateId }) => {
    return templateEntriesView(db, templateId) as unknown as TemplateEntryView[]
  })

  handle('scheduleTemplates:unassignedLoad', scheduleTemplateUnassignedLoadInput, ({ templateId }) => {
    return unassignedLoadForTemplate(db, templateId) as unknown as UnassignedLoadRow[]
  })

  handle('scheduleTemplates:placeEntry', placeEntryInput, (input) => {
    return db.transaction((tx) => {
      const created = placeEntry(tx, input, { reason: 'постановка занятия в шаблон' })
      return templateEntriesView(tx, input.templateId).find((e) => e.id === created.id)! as unknown as TemplateEntryView
    })
  })

  handle('scheduleTemplates:moveEntry', moveEntryInput, (input) => {
    return db.transaction((tx) => {
      const updated = moveEntry(tx, input, { reason: 'перенос занятия в шаблоне' })
      return templateEntriesView(tx, updated.templateId as number).find((e) => e.id === updated.id)! as unknown as TemplateEntryView
    })
  })

  handle('scheduleTemplates:setLocked', setEntryLockedInput, ({ id, rowVersion, isLocked }) => {
    setEntryLocked(db, id, rowVersion, isLocked, { reason: isLocked ? 'закрепление занятия' : 'снятие закрепления' })
    return { ok: true as const }
  })

  handle('scheduleTemplates:removeEntry', removeEntryInput, ({ id, rowVersion }) => {
    db.transaction((tx) => removeEntry(tx, id, rowVersion, { reason: 'снятие занятия из шаблона' }))
    return { ok: true as const }
  })

  handle('scheduleTemplates:rolloutPreview', rolloutRangeInput, (input) => {
    const plan = planRollout(db, input)
    return { toCreate: plan.toCreate, toUpdate: plan.toUpdate, toCancel: plan.toCancel, items: plan.items } as RolloutPreview
  })

  handle('scheduleTemplates:rolloutApply', rolloutRangeInput, (input) => {
    const { operationId, result } = runOperation(db, 'rollout', input, (tx, opId) => {
      const plan = planRollout(tx, input)
      return applyRollout(tx, plan, { operationId: opId, reason: 'раскатка шаблона на даты' })
    })
    return { operationId, created: result.created, updated: result.updated, cancelled: result.cancelled } as RolloutApplyResult
  })

  handle('schedule:conflicts', scheduleConflictsInput, ({ dateFrom, dateTo }) => {
    return listLessonConflicts(db, dateFrom, dateTo) as unknown as ScheduleConflictView[]
  })
}
