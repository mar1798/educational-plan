import { type BrowserWindow, dialog } from 'electron'
import { exportExcelInput, exportPdfInput, reportsExportExcelInput, reportsExportPdfInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import {
  exportDeductedHoursReportExcel,
  exportGroupScheduleExcel,
  exportRoomUtilizationReportExcel,
  exportSummaryScheduleExcel,
  exportTeacherLoadReportExcel,
  exportTeacherScheduleExcel,
} from '../export/excel'
import {
  printDeductedHoursReportToPdf,
  printGroupScheduleToPdf,
  printRoomUtilizationReportToPdf,
  printSummaryScheduleToPdf,
  printTeacherLoadReportToPdf,
} from '../export/pdf'
import { handle } from './register'

async function saveDialog(getWindow: () => BrowserWindow | null, defaultPath: string, filterName: string, extension: string) {
  const win = getWindow()
  const filters = [{ name: filterName, extensions: [extension] }]
  return win ? dialog.showSaveDialog(win, { defaultPath, filters }) : dialog.showSaveDialog({ defaultPath, filters })
}

export function registerExportHandlers(db: Db, getWindow: () => BrowserWindow | null) {
  handle('export:excel', exportExcelInput, async ({ templateId, kind, targetId }) => {
    if ((kind === 'group' || kind === 'teacher') && targetId == null) {
      throw new Error(kind === 'group' ? 'Не выбрана группа для экспорта' : 'Не выбран преподаватель для экспорта')
    }
    const defaultName = kind === 'summary' ? 'raspisanie-svodnoe.xlsx' : `raspisanie-${kind}-${targetId}.xlsx`
    const result = await saveDialog(getWindow, defaultName, 'Excel', 'xlsx')
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
    const defaultName = groupId != null ? `raspisanie-gruppa-${groupId}.pdf` : 'raspisanie-svodnoe.pdf'
    const result = await saveDialog(getWindow, defaultName, 'PDF', 'pdf')
    if (result.canceled || !result.filePath) return { cancelled: true as const }

    const filePath = result.filePath
    if (groupId != null) await printGroupScheduleToPdf(db, templateId, groupId, filePath)
    else await printSummaryScheduleToPdf(db, templateId, filePath)
    return { path: filePath }
  })

  handle('reports:exportExcel', reportsExportExcelInput, async (params) => {
    const defaultName = { teacherLoad: 'otchet-nagruzka.xlsx', deductedHours: 'otchet-vychtennye-chasy.xlsx', roomUtilization: 'otchet-kabinety.xlsx' }[params.report]
    const result = await saveDialog(getWindow, defaultName, 'Excel', 'xlsx')
    if (result.canceled || !result.filePath) return { cancelled: true as const }

    const filePath = result.filePath
    if (params.report === 'teacherLoad') await exportTeacherLoadReportExcel(db, params.academicYearId, filePath)
    else if (params.report === 'deductedHours') await exportDeductedHoursReportExcel(db, params.dateFrom, params.dateTo, filePath)
    else await exportRoomUtilizationReportExcel(db, params.dateFrom, params.dateTo, filePath)

    return { path: filePath }
  })

  handle('reports:exportPdf', reportsExportPdfInput, async (params) => {
    const defaultName = { teacherLoad: 'otchet-nagruzka.pdf', deductedHours: 'otchet-vychtennye-chasy.pdf', roomUtilization: 'otchet-kabinety.pdf' }[params.report]
    const result = await saveDialog(getWindow, defaultName, 'PDF', 'pdf')
    if (result.canceled || !result.filePath) return { cancelled: true as const }

    const filePath = result.filePath
    if (params.report === 'teacherLoad') await printTeacherLoadReportToPdf(db, params.academicYearId, filePath)
    else if (params.report === 'deductedHours') await printDeductedHoursReportToPdf(db, params.dateFrom, params.dateTo, filePath)
    else await printRoomUtilizationReportToPdf(db, params.dateFrom, params.dateTo, filePath)

    return { path: filePath }
  })
}
