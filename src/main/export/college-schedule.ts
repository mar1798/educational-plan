/**
 * Сводное расписание в формате колледжа (§этап Б, разбор образца в PLAN-schedule-feedback.md):
 * слева день и время, сверху группы; те же служебные колонки зеркально справа; каждая пара —
 * две строки (дисциплина / преподаватель). Печатается из Excel: PDF на 31 колонку нечитаем.
 */
import ExcelJS from 'exceljs'
import { eq } from 'drizzle-orm'
import { buildSummaryCell } from '../../shared/schedule/summary-cell'
import { summaryGroupColumns, templateEntriesView, type TemplateEntryView } from '../db/repo/schedule-template'
import type { DbLike } from '../db/repo/types'
import { academicYear, semester } from '../db/schema/calendar'
import { appSetting } from '../db/schema/app-setting'
import { pairGrid } from '../db/schema/org'
import { scheduleTemplate } from '../db/schema/schedule'

export const SETTING_DIRECTOR = 'schedule_director_name'
export const SETTING_DEPUTY = 'schedule_deputy_name'

const DAYS = [
  { no: 1, label: 'Понедельник' },
  { no: 2, label: 'Вторник' },
  { no: 3, label: 'Среда' },
  { no: 4, label: 'Четверг' },
  { no: 5, label: 'Пятница' },
  { no: 6, label: 'Суббота' },
]

const FONT = 'Times New Roman'
const THIN = { style: 'thin' as const }
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const HEADER_ROW = 3
const FIRST_DATA_ROW = 4
const LEFT_COLS = 3

function setting(tx: DbLike, key: string): string {
  return tx.select().from(appSetting).where(eq(appSetting.key, key)).get()?.value.trim() ?? ''
}

/** «Утверждаю: директор ________ Иванов И.И.» — без ФИО остаётся должность и линия для подписи. */
function signatureLine(prefix: string, role: string, name: string): string {
  return `${prefix}: ${role} ____________${name ? `  ${name}` : ''}`
}

export function collegeCellText(entries: TemplateEntryView[], groupId: number): { top: string; bottom: string } {
  const parts = buildSummaryCell(entries, groupId)
  return { top: parts.map((p) => p.top).join('; '), bottom: parts.map((p) => p.bottom).join('; ') }
}

export async function exportCollegeScheduleExcel(tx: DbLike, templateId: number, filePath: string): Promise<void> {
  const tmpl = tx.select().from(scheduleTemplate).where(eq(scheduleTemplate.id, templateId)).get()
  if (!tmpl) throw new Error(`Версия шаблона #${templateId} не найдена`)
  const sem = tx.select().from(semester).where(eq(semester.id, tmpl.semesterId)).get()
  const year = sem ? tx.select().from(academicYear).where(eq(academicYear.id, sem.academicYearId)).get() : undefined

  const pairs = tx
    .select()
    .from(pairGrid)
    .all()
    .filter((p) => p.enabled)
    .sort((a, b) => a.pairNo - b.pairNo)
  const columns = summaryGroupColumns(tx)
  const entries = templateEntriesView(tx, templateId)

  const byCell = new Map<string, TemplateEntryView[]>()
  for (const e of entries) {
    for (const groupId of new Set(e.attendees.map((a) => a.groupId))) {
      const key = `${e.dayOfWeek}:${e.pairNo}:${groupId}`
      byCell.set(key, [...(byCell.get(key) ?? []), e])
    }
  }

  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Расписание')
  const groupsFrom = LEFT_COLS + 1
  const groupsTo = LEFT_COLS + columns.length
  const lastCol = groupsTo + LEFT_COLS
  const rowsPerDay = pairs.length * 2
  const lastDataRow = FIRST_DATA_ROW + DAYS.length * rowsPerDay - 1
  const footerRow = lastDataRow + 2

  const bold = (size: number): Partial<ExcelJS.Font> => ({ name: FONT, bold: true, size })

  // Шапка листа: год, подпись директора и подпись зама внизу.
  sheet.mergeCells(1, 1, 1, lastCol)
  const title = sheet.getCell(1, 1)
  title.value = `Расписание на ${year?.name ?? ''} учебный год`.replace('  ', ' ')
  title.font = bold(28)
  title.alignment = { horizontal: 'center', vertical: 'middle' }

  sheet.mergeCells(2, Math.max(1, lastCol - 12), 2, lastCol)
  const approve = sheet.getCell(2, Math.max(1, lastCol - 12))
  approve.value = signatureLine('Утверждаю', 'директор', setting(tx, SETTING_DIRECTOR))
  approve.font = bold(20)
  approve.alignment = { horizontal: 'right', vertical: 'middle' }

  sheet.mergeCells(footerRow, 1, footerRow, Math.min(lastCol, 14))
  const agreed = sheet.getCell(footerRow, 1)
  agreed.value = signatureLine('Согласовано', 'зам. директора', setting(tx, SETTING_DEPUTY))
  agreed.font = bold(20)
  agreed.alignment = { horizontal: 'left', vertical: 'middle' }

  // Строка групп: служебные колонки повторены справа зеркально, чтобы широкий лист читался с обоих краёв.
  const leftHeads = ['День', 'Пары', 'Часы занятий']
  const rightHeads = [...leftHeads].reverse()
  const head = (col: number, text: string) => {
    const c = sheet.getCell(HEADER_ROW, col)
    c.value = text
    c.font = bold(20)
    c.border = BORDER
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  }
  leftHeads.forEach((t, i) => head(1 + i, t))
  columns.forEach((g, i) => head(groupsFrom + i, g.name))
  rightHeads.forEach((t, i) => head(groupsTo + 1 + i, t))

  // Колонки: служебные узкие, группы одинаковой ширины.
  const serviceWidths = [6, 6, 14]
  serviceWidths.forEach((w, i) => {
    sheet.getColumn(1 + i).width = w
    sheet.getColumn(lastCol - i).width = w
  })
  for (let c = groupsFrom; c <= groupsTo; c++) sheet.getColumn(c).width = 34

  const side = (col: number, row: number, text: string | number, size: number, rotate = false) => {
    const c = sheet.getCell(row, col)
    c.value = text
    c.font = bold(size)
    c.border = BORDER
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, textRotation: rotate ? 90 : 0 }
  }

  DAYS.forEach((day, dayIdx) => {
    const dayFirst = FIRST_DATA_ROW + dayIdx * rowsPerDay
    // День — вертикальное объединение на все строки дня, текст повёрнут на 90°.
    for (const col of [1, lastCol]) {
      sheet.mergeCells(dayFirst, col, dayFirst + rowsPerDay - 1, col)
      side(col, dayFirst, day.label, 22, true)
    }

    pairs.forEach((p, pairIdx) => {
      const r1 = dayFirst + pairIdx * 2
      const r2 = r1 + 1
      const time = `${p.startsAt}–${p.endsAt}`
      for (const [col, text] of [[LEFT_COLS - 1, p.pairNo], [LEFT_COLS, time], [lastCol - 1, p.pairNo], [lastCol - 2, time]] as const) {
        sheet.mergeCells(r1, col, r2, col)
        side(col, r1, text, 18)
      }

      columns.forEach((g, i) => {
        const col = groupsFrom + i
        const { top, bottom } = collegeCellText(byCell.get(`${day.no}:${p.pairNo}:${g.id}`) ?? [], g.id)
        const topCell = sheet.getCell(r1, col)
        topCell.value = top || null
        topCell.font = bold(20)
        topCell.border = { top: THIN, left: THIN, right: THIN }
        topCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, shrinkToFit: false }
        const bottomCell = sheet.getCell(r2, col)
        bottomCell.value = bottom || null
        bottomCell.font = bold(14)
        bottomCell.border = { bottom: THIN, left: THIN, right: THIN }
        bottomCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      })
      sheet.getRow(r1).height = 34
      sheet.getRow(r2).height = 22
    })
  })

  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 4,
    fitToHeight: 3,
    margins: { left: 0.39, right: 0.39, top: 0.39, bottom: 0.39, header: 0.2, footer: 0.2 },
    printArea: `A1:${sheet.getColumn(lastCol).letter}${footerRow}`,
  }
  // Закреплены шапка с группами и три левые колонки, чтобы при прокрутке не терять ориентиры.
  sheet.views = [{ state: 'frozen', xSplit: LEFT_COLS, ySplit: HEADER_ROW }]

  await wb.xlsx.writeFile(filePath)
}
