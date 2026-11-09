import { type BrowserWindow, dialog } from 'electron'
import { exportCollegeScheduleInput, exportExcelInput, exportPdfInput, reportsExportExcelInput, reportsExportPdfInput } from '../../shared/ipc/schemas'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { scheduleTemplate } from '../db/schema/schedule'
import {
  exportDeductedHoursReportExcel,
  exportGroupScheduleExcel,
  exportRoomUtilizationReportExcel,
  exportTeacherLoadReportExcel,
  exportTeacherScheduleExcel,
} from '../export/excel'
import { exportCollegeScheduleExcel } from '../export/college-schedule'
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

/** Версий шаблона у семестра несколько (фазы, решение 53) — имя файла по умолчанию их различает. */
function collegeFileName(db: Db, templateId: number): string {
  const tmpl = db.select().from(scheduleTemplate).where(eq(scheduleTemplate.id, templateId)).get()
  return tmpl ? `raspisanie-kolledzh-v${tmpl.versionNo}-s-${tmpl.effectiveFrom}.xlsx` : 'raspisanie-kolledzh.xlsx'
}

export function registerExportHandlers(db: Db, getWindow: () => BrowserWindow | null) {
  handle('export:excel', exportExcelInput, async ({ templateId, kind, targetId }) => {
    if ((kind === 'group' || kind === 'teacher') && targetId == null) {
      throw new Error(kind === 'group' ? 'Не выбрана группа для экспорта' : 'Не выбран преподаватель для экспорта')
    }
    const defaultName = kind === 'summary' ? collegeFileName(db, templateId) : `raspisanie-${kind}-${targetId}.xlsx`
    const result = await saveDialog(getWindow, defaultName, 'Excel', 'xlsx')
    if (result.canceled || !result.filePath) return { cancelled: true as const }

    // Экспорт только читает — обычная транзакция better-sqlite3 синхронна и не годится для
    // async-колбэка (ExcelJS пишет файл асинхронно), поэтому читаем прямо через `db` (DbLike).
    const filePath = result.filePath
    if (kind === 'group') await exportGroupScheduleExcel(db, templateId, targetId!, filePath)
    else if (kind === 'teacher') await exportTeacherScheduleExcel(db, templateId, targetId!, filePath)
    // Сводное — всегда один лист в формате колледжа (решение 49): «лист на группу» завуч не принимает.
    else await exportCollegeScheduleExcel(db, templateId, filePath)

    return { path: filePath }
  })

  handle('export:collegeScheduleExcel', exportCollegeScheduleInput, async ({ templateId }) => {
    const result = await saveDialog(getWindow, collegeFileName(db, templateId), 'Excel', 'xlsx')
    if (result.canceled || !result.filePath) return { cancelled: true as const }
    await exportCollegeScheduleExcel(db, templateId, result.filePath)
    return { path: result.filePath }
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
