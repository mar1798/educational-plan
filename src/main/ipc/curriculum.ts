import { and, asc, eq } from 'drizzle-orm'
import type { Curriculum, CurriculumRow, CurriculumRowEditPreview, CurriculumRowsBulkCreateResult, CurriculumWeek } from '../../shared/ipc/contract'
import {
  curriculaListInput,
  curriculumApproveInput,
  curriculumArchiveInput,
  curriculumCopyInput,
  curriculumDeleteInput,
  curriculumRowCreateInput,
  curriculumRowDeleteInput,
  curriculumRowEditInput,
  curriculumRowEditPreviewInput,
  curriculumRowsBulkCreateInput,
  curriculumRowsListInput,
  curriculumSaveInput,
  curriculumWeeksGenerateInput,
  curriculumWeeksListInput,
  curriculumWeeksSaveInput,
} from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { createRow, updateRow } from '../db/repo/base-repo'
import {
  copyCurriculum,
  countAffectedLessons,
  createCurriculumRow,
  deleteCurriculum,
  deleteCurriculumRowCascade,
  editCurriculumRow,
  generateCurriculumWeeks,
  listCurriculumWeeks,
  updateCurriculumWeeks,
} from '../db/repo/curriculum'
import { nowIso } from '../db/repo/audit'
import { applyCurriculumRows } from '../import/apply'
import { runOperation } from '../db/repo/operations'
import { ensureDeletable } from '../db/repo/reference-guard'
import { curriculum, curriculumRow } from '../db/schema/curriculum'
import { teachingLoad } from '../db/schema/load'
import { handle } from './register'

export function registerCurriculumHandlers(db: Db) {
  handle('curricula:list', curriculaListInput, ({ specialityId, includeArchived }) => {
    const conds = []
    if (specialityId != null) conds.push(eq(curriculum.specialityId, specialityId))
    const rows = (conds.length ? db.select().from(curriculum).where(and(...conds)) : db.select().from(curriculum))
      .orderBy(asc(curriculum.admissionYear))
      .all()
    const filtered = includeArchived ? rows : rows.filter((r) => r.status !== 'archived')
    return filtered as unknown as Curriculum[]
  })

  handle('curricula:save', curriculumSaveInput, ({ id, rowVersion, ...values }) => {
    const row =
      id != null
        ? updateRow(db, curriculum, id, values, rowVersion!, { reason: 'правка учебного плана' })
        : createRow(db, curriculum, { ...values, status: 'draft' }, { reason: 'создание учебного плана' })
    return row as unknown as Curriculum
  })

  handle('curricula:approve', curriculumApproveInput, ({ id, rowVersion }) => {
    updateRow(db, curriculum, id, { status: 'approved', approvedAt: nowIso(), approvedBy: 'admin' }, rowVersion, {
      reason: 'утверждение учебного плана',
    })
    return { ok: true as const }
  })

  handle('curricula:archive', curriculumArchiveInput, ({ id, rowVersion, archived }) => {
    // Восстановление всегда возвращает в черновик (§3.2): утверждение — отдельное
    // сознательное действие заново, а не автоматический откат в прежний статус.
    updateRow(db, curriculum, id, { status: archived ? 'archived' : 'draft' }, rowVersion, { reason: 'архивация учебного плана' })
    return { ok: true as const }
  })

  handle('curricula:delete', curriculumDeleteInput, ({ id }) => {
    const { operationId } = runOperation(db, 'bulk_edit', { curriculumId: id }, (tx, operationId) =>
      deleteCurriculum(tx, id, { operationId, reason: 'удаление учебного плана' }),
    )
    return { operationId }
  })

  handle('curricula:copy', curriculumCopyInput, ({ fromCurriculumId, specialityId, admissionYear, name }) => {
    const { operationId, result } = runOperation(db, 'bulk_edit', { fromCurriculumId, specialityId, admissionYear, name }, (tx, operationId) =>
      copyCurriculum(tx, fromCurriculumId, { specialityId, admissionYear, name }, { operationId, reason: 'копирование учебного плана' }),
    )
    return { operationId, curriculum: result as unknown as Curriculum }
  })

  handle('curriculumRows:list', curriculumRowsListInput, ({ curriculumId }) => {
    const rows = db.select().from(curriculumRow).where(eq(curriculumRow.curriculumId, curriculumId)).orderBy(asc(curriculumRow.semesterNo)).all()
    return rows as unknown as CurriculumRow[]
  })

  handle('curriculumRows:create', curriculumRowCreateInput, ({ curriculumId, validFrom, ...fields }) => {
    const row = createCurriculumRow(db, curriculumId, fields, validFrom, { reason: 'добавление строки плана' })
    return row as unknown as CurriculumRow
  })

  handle('curriculumRows:editPreview', curriculumRowEditPreviewInput, ({ id, effectiveFrom }) => {
    const preview: CurriculumRowEditPreview = { affectedLessons: countAffectedLessons(db, id, effectiveFrom) }
    return preview
  })

  handle('curriculumRows:edit', curriculumRowEditInput, ({ id, rowVersion, effectiveFrom, ...fields }) => {
    const { operationId, result } = runOperation(db, 'bulk_edit', { id, effectiveFrom, fields }, (tx, operationId) =>
      editCurriculumRow(tx, id, fields, rowVersion, effectiveFrom, { operationId, reason: 'правка строки плана' }),
    )
    return { operationId, row: result.row as unknown as CurriculumRow, versioned: result.versioned }
  })

  handle('curriculumRows:delete', curriculumRowDeleteInput, ({ id }) => {
    db.transaction((tx) => {
      ensureDeletable(tx, `Строка плана #${id}`, id, [{ table: teachingLoad, column: teachingLoad.curriculumRowId, nounRu: 'нагрузке' }])
      deleteCurriculumRowCascade(tx, id, { reason: 'удаление строки плана' })
    })
    return { ok: true as const }
  })

  handle('curriculumRows:bulkCreate', curriculumRowsBulkCreateInput, ({ curriculumId, rows, validFrom }) => {
    const { operationId, result } = runOperation(db, 'bulk_edit', { curriculumId, rowCount: rows.length }, (tx, operationId) =>
      applyCurriculumRows(tx, curriculumId, rows, validFrom, { operationId, reason: 'быстрый ввод строк плана из буфера' }),
    )
    return { operationId, created: result.created, skipped: result.skipped } as CurriculumRowsBulkCreateResult
  })

  handle('curriculumWeeks:list', curriculumWeeksListInput, ({ curriculumRowId }) => {
    return listCurriculumWeeks(db, curriculumRowId) as unknown as CurriculumWeek[]
  })

  handle('curriculumWeeks:generate', curriculumWeeksGenerateInput, ({ curriculumRowId, weekCount }) => {
    const weeks = db.transaction((tx) => generateCurriculumWeeks(tx, curriculumRowId, weekCount, { reason: 'генерация недельной раскладки' }))
    return weeks as unknown as CurriculumWeek[]
  })

  handle('curriculumWeeks:save', curriculumWeeksSaveInput, ({ curriculumRowId, weeks }) => {
    const saved = db.transaction((tx) => updateCurriculumWeeks(tx, curriculumRowId, weeks, { reason: 'правка недельной раскладки' }))
    return saved as unknown as CurriculumWeek[]
  })
}
