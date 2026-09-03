import { basename } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import { eq } from 'drizzle-orm'
import type { ImportApplyResult, ImportProfile, SheetInfo } from '../../shared/ipc/contract'
import {
  importApplyInput,
  importListSheetsInput,
  importPickFileInput,
  importProfileDeleteInput,
  importProfileSaveInput,
  importProfilesListInput,
  importReadGridInput,
} from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { createRow, deleteRow, updateRow } from '../db/repo/base-repo'
import { runOperation } from '../db/repo/operations'
import { importProfile } from '../db/schema/import'
import { applyCalendarPeriodRows, applyCurriculumRows, applyTeacherRows, applyTeachingLoadRows } from '../import/apply'
import { listSheets, readSheetGrid } from '../import/workbook'
import { handle } from './register'

export interface ImportDeps {
  db: Db
  getWindow: () => BrowserWindow | null
}

export function registerImportHandlers({ db, getWindow }: ImportDeps) {
  handle('import:pickFile', importPickFileInput, async () => {
    const win = getWindow()
    const dialogOptions = { properties: ['openFile' as const], title: 'Файл для импорта', filters: [{ name: 'Excel', extensions: ['xlsx'] }] }
    const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true as const }
    const filePath = result.filePaths[0]!
    return { filePath, fileName: basename(filePath) }
  })

  handle('import:listSheets', importListSheetsInput, async ({ filePath }) => {
    return (await listSheets(filePath)) as SheetInfo[]
  })

  handle('import:readGrid', importReadGridInput, async ({ filePath, sheetName }) => {
    return readSheetGrid(filePath, sheetName)
  })

  handle('import:profiles:list', importProfilesListInput, ({ targetEntity }) => {
    const rows = targetEntity
      ? db.select().from(importProfile).where(eq(importProfile.targetEntity, targetEntity)).all()
      : db.select().from(importProfile).all()
    return rows as unknown as ImportProfile[]
  })

  handle('import:profiles:save', importProfileSaveInput, ({ id, rowVersion, ...values }) => {
    const row =
      id != null
        ? updateRow(db, importProfile, id, values, rowVersion!, { reason: 'правка профиля импорта' })
        : createRow(db, importProfile, values, { reason: 'сохранение профиля импорта' })
    return row as unknown as ImportProfile
  })

  handle('import:profiles:delete', importProfileDeleteInput, ({ id }) => {
    deleteRow(db, importProfile, id, { reason: 'удаление профиля импорта' })
    return { ok: true as const }
  })

  handle('import:apply', importApplyInput, ({ targetEntity, rows, curriculumId, semesterId, validFrom }) => {
    const { operationId, result } = runOperation(db, 'import', { targetEntity, rowCount: rows.length }, (tx, operationId) => {
      const ctx = { operationId, reason: 'импорт из Excel' }
      switch (targetEntity) {
        case 'teacher':
          return applyTeacherRows(tx, rows, ctx)
        case 'calendar_period':
          return applyCalendarPeriodRows(tx, rows, ctx)
        case 'curriculum':
          if (curriculumId == null) throw new Error('Не выбран учебный план, в который импортировать строки')
          return applyCurriculumRows(tx, curriculumId, rows, validFrom, ctx)
        case 'teaching_load':
          if (semesterId == null) throw new Error('Не выбран семестр, в который импортировать нагрузку')
          return applyTeachingLoadRows(tx, semesterId, rows, validFrom, ctx)
      }
    })
    return { operationId, created: result.created, skipped: result.skipped } as ImportApplyResult
  })
}
