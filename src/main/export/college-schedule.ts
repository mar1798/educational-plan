/**
 * Сводное расписание в формате колледжа (решение 49, шаблон завуча от 06.11.2026): ОДИН лист,
 * колонки «День | Пары | Часы занятий», дальше все группы подряд; каждая пара — две строки
 * (дисциплина / преподаватель). Зеркальных служебных колонок справа в шаблоне нет — убраны.
 * Подгруппы — через `/`, поточная пара объединяет ячейки соседних групп и помечена «(поток)».
 * Печатается из Excel: PDF на 31 колонку нечитаем.
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

// Дни заглавными, как в шаблоне завуча («ПОНЕДЕЛЬНИК»); импорт сетки сравнивает без учёта регистра.
const DAYS = [
  { no: 1, label: 'ПОНЕДЕЛЬНИК' },
  { no: 2, label: 'ВТОРНИК' },
  { no: 3, label: 'СРЕДА' },
  { no: 4, label: 'ЧЕТВЕРГ' },
  { no: 5, label: 'ПЯТНИЦА' },
  { no: 6, label: 'СУББОТА' },
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

export const STREAM_MARK = '(поток)'

function ruDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

/** « (действует с 05.10.2026 по 18.10.2026)» — период версии шаблона для заголовка листа. */
export function versionPeriod(tmpl: { effectiveFrom: string; effectiveTo: string | null }): string {
  return ` (действует с ${ruDate(tmpl.effectiveFrom)}${tmpl.effectiveTo ? ` по ${ruDate(tmpl.effectiveTo)}` : ''})`
}

export interface CollegeCell {
  top: string
  bottom: string
  /** Записи поточной пары; у обычной ячейки null. Соседние группы с тем же набором объединяются. */
  streamKey: string | null
  /** Занятие только у одной подгруппы прижимается к своей стороне, как в шаблоне («Ист. КР /» слева). */
  align: 'left' | 'center' | 'right'
}

export function collegeCellText(entries: TemplateEntryView[], groupId: number): CollegeCell {
  const parts = buildSummaryCell(entries, groupId)
  const top = parts.map((p) => (p.isStream ? `${p.top} ${STREAM_MARK}` : p.top.trim())).join('; ')
  const bottom = parts.map((p) => p.bottom.trim()).join('; ')
  const only = parts.length === 1 ? parts[0]! : null
  const streamKey = only?.isStream ? only.entryIds.join(',') : null
  const sided = only && !only.isStream ? only.top.trim() : ''
  const align = sided.startsWith('/') ? 'right' : sided.endsWith('/') ? 'left' : 'center'
  return { top, bottom, streamKey, align }
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
  const groupsTo = LEFT_COLS + Math.max(1, columns.length)
  const lastCol = groupsTo
  const rowsPerDay = pairs.length * 2
  const lastDataRow = FIRST_DATA_ROW + DAYS.length * rowsPerDay - 1
  const footerRow = lastDataRow + 2

  const bold = (size: number): Partial<ExcelJS.Font> => ({ name: FONT, bold: true, size })

  // Шапка листа: год, подпись директора и подпись зама внизу.
  sheet.mergeCells(1, 1, 1, lastCol)
  const title = sheet.getCell(1, 1)
  // После генерации по фазам у семестра несколько версий шаблона (решение 53): без даты действия
  // распечатки разных фаз не отличить.
  title.value = `Расписание на ${year?.name ?? ''} учебный год${versionPeriod(tmpl)}`.replace('  ', ' ')
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

  // Строка групп: «День | Пары | Часы занятий», дальше группы — как в шаблоне завуча.
  const leftHeads = ['День', 'Пары', 'Часы занятий']
  const head = (col: number, text: string) => {
    const c = sheet.getCell(HEADER_ROW, col)
    c.value = text
    c.font = bold(20)
    c.border = BORDER
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  }
  leftHeads.forEach((t, i) => head(1 + i, t))
  columns.forEach((g, i) => head(groupsFrom + i, g.name))

  // Колонки: служебные узкие, группы одинаковой ширины.
  const serviceWidths = [6, 6, 14]
  serviceWidths.forEach((w, i) => {
    sheet.getColumn(1 + i).width = w
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
    sheet.mergeCells(dayFirst, 1, dayFirst + rowsPerDay - 1, 1)
    side(1, dayFirst, day.label, 22, true)

    pairs.forEach((p, pairIdx) => {
      const r1 = dayFirst + pairIdx * 2
      const r2 = r1 + 1
      const time = `${p.startsAt}-${p.endsAt}`
      for (const [col, text] of [[LEFT_COLS - 1, p.pairNo], [LEFT_COLS, time]] as const) {
        sheet.mergeCells(r1, col, r2, col)
        side(col, r1, text, 18)
      }

      const cells = columns.map((g) => collegeCellText(byCell.get(`${day.no}:${p.pairNo}:${g.id}`) ?? [], g.id))
      for (let i = 0; i < cells.length; ) {
        const cell = cells[i]!
        // Поточная пара у соседних групп — одна объединённая ячейка на всех: так поток виден
        // сразу, а не угадывается по одинаковому тексту в разных колонках.
        let span = 1
        while (cell.streamKey != null && i + span < cells.length && cells[i + span]!.streamKey === cell.streamKey) span++
        const col = groupsFrom + i
        const toCol = col + span - 1
        if (span > 1) {
          sheet.mergeCells(r1, col, r1, toCol)
          sheet.mergeCells(r2, col, r2, toCol)
        }
        const topCell = sheet.getCell(r1, col)
        topCell.value = cell.top || null
        topCell.font = bold(20)
        topCell.border = { top: THIN, left: THIN, right: THIN }
        topCell.alignment = { horizontal: cell.align, vertical: 'middle', wrapText: true, shrinkToFit: false }
        const bottomCell = sheet.getCell(r2, col)
        bottomCell.value = cell.bottom || null
        bottomCell.font = bold(14)
        bottomCell.border = { bottom: THIN, left: THIN, right: THIN }
        bottomCell.alignment = { horizontal: cell.align, vertical: 'middle', wrapText: true }
        i += span
      }
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
