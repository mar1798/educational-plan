import { type BrowserWindow, dialog } from 'electron'
import { exportExcelInput, exportPdfInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { exportGroupScheduleExcel, exportSummaryScheduleExcel, exportTeacherScheduleExcel } from '../export/excel'
import { printGroupScheduleToPdf } from '../export/pdf'
import { handle } from './register'

export function registerExportHandlers(db: Db, getWindow: () => BrowserWindow | null) {
  handle('export:excel', exportExcelInput, async ({ templateId, kind, targetId }) => {
    if ((kind === 'group' || kind === 'teacher') && targetId == null) {
      throw new Error(kind === 'group' ? 'Не выбрана группа для экспорта' : 'Не выбран преподаватель для экспорта')
    }
    const defaultName = kind === 'summary' ? 'raspisanie-svodnoe.xlsx' : `raspisanie-${kind}-${targetId}.xlsx`
    const win = getWindow()
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
      : await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
    if (result.canceled || !result.filePath) return { cancelled: true as const }

    // Экспорт только читает — обычная транзакция better-sqlite3 синхронна и не годится для
    // async-колбэка (ExcelJS пишет файл асинхронно), поэтому читаем прямо через `db` (DbLike).
    const filePath = result.filePath
    if (kind === 'group') await exportGroupScheduleExcel(db, templateId, targetId!, filePath)
    else if (kind === 'teacher') await exportTeacherScheduleExcel(db, templateId, targetId!, filePath)
    else await exportSummaryScheduleExcel(db, templateId, filePath)

    return { path: filePath }
  })

  handle('export:pdf', exportPdfInput, async ({ templateId, groupId }) => {
    const win = getWindow()
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: `raspisanie-gruppa-${groupId}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
      : await dialog.showSaveDialog({ defaultPath: `raspisanie-gruppa-${groupId}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (result.canceled || !result.filePath) return { cancelled: true as const }

    const filePath = result.filePath
    await printGroupScheduleToPdf(db, templateId, groupId, filePath)
    return { path: filePath }
  })
}
