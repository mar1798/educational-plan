import { asc, eq } from 'drizzle-orm'
import type { DivisionSchemeWithSubgroups } from '../../shared/ipc/contract'
import {
  divisionSchemeCloseInput,
  divisionSchemeCreateInput,
  divisionSchemeDeleteInput,
  divisionSchemeSetDefaultInput,
  divisionSchemeUpdateBoundsInput,
  divisionSchemesListInput,
} from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { closeRow, deleteRow, updateRow } from '../db/repo/base-repo'
import { createDivisionScheme, loadSchemeWithSubgroups, setDefaultDivisionScheme, updateSubgroupBounds } from '../db/repo/division-scheme'
import { ensureDeletable } from '../db/repo/reference-guard'
import { divisionScheme, subgroup } from '../db/schema/people'
import { teachingLoad } from '../db/schema/load'
import { lessonGroup } from '../db/schema/schedule'
import { handle } from './register'

export function registerDivisionSchemesHandlers(db: Db) {
  handle('divisionSchemes:listForGroup', divisionSchemesListInput, ({ groupId }) => {
    const schemes = db.select().from(divisionScheme).where(eq(divisionScheme.groupId, groupId)).orderBy(asc(divisionScheme.id)).all()
    return schemes.map((s) => loadSchemeWithSubgroups(db, s.id)) as unknown as DivisionSchemeWithSubgroups[]
  })

  handle('divisionSchemes:create', divisionSchemeCreateInput, (params) => {
    return db.transaction((tx) => createDivisionScheme(tx, params, { reason: 'создание схемы деления' })) as unknown as DivisionSchemeWithSubgroups
  })

  handle('divisionSchemes:updateBounds', divisionSchemeUpdateBoundsInput, ({ schemeId, bounds }) => {
    return db.transaction((tx) => updateSubgroupBounds(tx, schemeId, bounds, { reason: 'правка границ подгрупп' })) as unknown as DivisionSchemeWithSubgroups
  })

  handle('divisionSchemes:close', divisionSchemeCloseInput, ({ id, rowVersion, validTo }) => {
    if (validTo == null) {
      updateRow(db, divisionScheme, id, { validTo: null }, rowVersion, { reason: 'открытие схемы деления заново' })
    } else {
      closeRow(db, divisionScheme, id, validTo, rowVersion, { reason: 'закрытие схемы деления' })
    }
    return { ok: true as const }
  })

  handle('divisionSchemes:setDefault', divisionSchemeSetDefaultInput, ({ id }) => {
    db.transaction((tx) => setDefaultDivisionScheme(tx, id, { reason: 'смена основной схемы деления' }))
    return { ok: true as const }
  })

  handle('divisionSchemes:delete', divisionSchemeDeleteInput, ({ id }) => {
    const scheme = db.select().from(divisionScheme).where(eq(divisionScheme.id, id)).get()
    const label = `Схема деления «${scheme?.name ?? id}»`
    db.transaction((tx) => {
      ensureDeletable(tx, label, id, [{ table: teachingLoad, column: teachingLoad.divisionSchemeId, nounRu: 'нагрузке' }])
      const subgroups = tx.select().from(subgroup).where(eq(subgroup.schemeId, id)).all()
      for (const sg of subgroups) {
        ensureDeletable(tx, label, sg.id, [
          { table: teachingLoad, column: teachingLoad.subgroupId, nounRu: 'нагрузке' },
          { table: lessonGroup, column: lessonGroup.subgroupId, nounRu: 'занятиях' },
        ])
      }
      for (const sg of subgroups) deleteRow(tx, subgroup, sg.id, { reason: 'удаление схемы деления' })
      deleteRow(tx, divisionScheme, id, { reason: 'удаление схемы деления' })
    })
    return { ok: true as const }
  })
}
