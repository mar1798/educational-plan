/**
 * Печатные формы (§5.11, §этап 7 PLAN.md): HTML + `@media print`-совместимая вёрстка,
 * отрисованная `webContents.printToPDF` в скрытом окне — расписание (A4 альбомная) и
 * табличные отчёты этапа 7 (A4 книжная), общий движок печати — `printHtmlToPdf`.
 */
import { mkdtemp, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { BrowserWindow } from 'electron'
import { templateEntriesView, type TemplateEntryView } from '../db/repo/schedule-template'
import { deductedHoursReport, roomUtilizationReport, teacherLoadReport } from '../db/repo/reports'
import type { DbLike } from '../db/repo/types'
import { pairGrid } from '../db/schema/org'
import { studyGroup } from '../db/schema/people'

const WEEKDAY_LABEL: Record<number, string> = {
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
  6: 'Суббота',
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Общий движок печати: HTML во временном файле → скрытое окно → `printToPDF`. */
async function printHtmlToPdf(html: string, filePath: string, landscape: boolean): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'eduplan-print-'))
  const htmlPath = join(dir, 'page.html')
  await writeFile(htmlPath, html, 'utf-8')

  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadFile(htmlPath)
    const pdf = await win.webContents.printToPDF({ landscape, pageSize: 'A4', printBackground: true })
    await writeFile(filePath, pdf)
  } finally {
    win.destroy()
    await unlink(htmlPath).catch(() => {})
  }
}

function enabledPairNumbers(tx: DbLike): number[] {
  const rows = tx.select().from(pairGrid).all()
  if (rows.length === 0) return [1, 2, 3, 4, 5, 6]
  return rows.filter((p) => p.enabled).sort((a, b) => a.pairNo - b.pairNo).map((p) => p.pairNo)
}

function cellHtml(entries: TemplateEntryView[], day: number, pairNo: number): string {
  return entries
    .filter((e) => e.dayOfWeek === day && e.pairNo === pairNo)
    .map((e) => {
      const who = e.attendees.map((a) => (a.subgroupNo != null ? `${a.groupName} п/гр ${a.subgroupNo}` : a.groupName)).join(', ')
      const room = e.roomLabel ? ` · ауд. ${escapeHtml(e.roomLabel)}` : ''
      const parity = e.weekParity === 'odd' ? ' (нечёт.)' : e.weekParity === 'even' ? ' (чёт.)' : ''
      return `<div class="entry"><b>${escapeHtml(e.disciplineName)}</b>${parity}<br>${escapeHtml(e.teacherName)} · ${escapeHtml(who)}${room}</div>`
    })
    .join('')
}

function gridTableHtml(title: string, entries: TemplateEntryView[], pairNumbers: number[]): string {
  const rows = pairNumbers
    .map((p) => `<tr><td class="pair">${p}</td>${[1, 2, 3, 4, 5, 6].map((d) => `<td>${cellHtml(entries, d, p)}</td>`).join('')}</tr>`)
    .join('')
  const headCells = [1, 2, 3, 4, 5, 6].map((d) => `<th>${WEEKDAY_LABEL[d]}</th>`).join('')
  return `<h1>${escapeHtml(title)}</h1>
  <table>
    <thead><tr><th></th>${headCells}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

const GRID_STYLE = `
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #999; padding: 4px; vertical-align: top; word-wrap: break-word; }
  th { background: #eee; }
  .pair { text-align: center; width: 24px; }
  .entry { margin-bottom: 4px; }
  .sheet { page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }
`

function buildHtml(title: string, entries: TemplateEntryView[], pairNumbers: number[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${GRID_STYLE}</style></head><body>${gridTableHtml(title, entries, pairNumbers)}</body></html>`
}

export async function printGroupScheduleToPdf(tx: DbLike, templateId: number, groupId: number, filePath: string): Promise<void> {
  const entries = templateEntriesView(tx, templateId).filter((e) => e.attendees.some((a) => a.groupId === groupId))
  const group = tx.select().from(studyGroup).where(eq(studyGroup.id, groupId)).get()
  const html = buildHtml(`Расписание ${group?.name ?? `#${groupId}`}`, entries, enabledPairNumbers(tx))
  await printHtmlToPdf(html, filePath, true)
}

/** Сводное расписание колледжа (§этап 7): по странице на каждую группу, встречающуюся в шаблоне. */
export async function printSummaryScheduleToPdf(tx: DbLike, templateId: number, filePath: string): Promise<void> {
  const entries = templateEntriesView(tx, templateId)
  const groupIds = [...new Set(entries.flatMap((e) => e.attendees.map((a) => a.groupId)))]
  const pairNumbers = enabledPairNumbers(tx)

  const sheets =
    groupIds.length === 0
      ? [gridTableHtml('Сводное расписание', [], pairNumbers)]
      : groupIds.map((groupId) => {
          const group = tx.select().from(studyGroup).where(eq(studyGroup.id, groupId)).get()
          const groupEntries = entries.filter((e) => e.attendees.some((a) => a.groupId === groupId))
          return gridTableHtml(group?.name ?? `#${groupId}`, groupEntries, pairNumbers)
        })

  const body = sheets.map((s) => `<div class="sheet">${s}</div>`).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${GRID_STYLE}</style></head><body>${body}</body></html>`
  await printHtmlToPdf(html, filePath, true)
}

// Отчёты этапа 7 — обычная книжная таблица, без сетки 6×6.
interface ReportColumn<T> {
  label: string
  value: (row: T) => string | number
}

const REPORT_STYLE = `
  @page { size: A4 portrait; margin: 14mm; }
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 5px 6px; text-align: left; }
  th { background: #eee; }
`

function reportTableHtml<T>(title: string, columns: ReportColumn<T>[], rows: T[]): string {
  const head = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')
  const body = rows
    .map((row) => `<tr>${columns.map((c) => `<td>${escapeHtml(String(c.value(row)))}</td>`).join('')}</tr>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>${REPORT_STYLE}</style></head><body>
    <h1>${escapeHtml(title)}</h1>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  </body></html>`
}

const PERCENT = (n: number): string => `${Math.round(n * 100)}%`

export async function printTeacherLoadReportToPdf(tx: DbLike, academicYearId: number, filePath: string): Promise<void> {
  const rows = teacherLoadReport(tx, academicYearId)
  const html = reportTableHtml(
    'Выполнение нагрузки',
    [
      { label: 'Преподаватель', value: (r) => r.teacherName },
      { label: 'Категория', value: (r) => r.categoryTitle },
      { label: 'План, ч', value: (r) => r.planHours },
      { label: 'Факт, ч', value: (r) => r.factHours },
      { label: 'Прочие часы, ч', value: (r) => r.otherHours },
      { label: 'Итого, ч', value: (r) => r.totalHours },
      { label: 'Норма, ч', value: (r) => r.normHoursYear ?? '—' },
      { label: 'Недоработка, ч', value: (r) => r.shortfallHours ?? '—' },
    ],
    rows,
  )
  await printHtmlToPdf(html, filePath, true)
}

export async function printDeductedHoursReportToPdf(tx: DbLike, dateFrom: string, dateTo: string, filePath: string): Promise<void> {
  const rows = deductedHoursReport(tx, dateFrom, dateTo)
  const html = reportTableHtml(
    `Вычтенные часы ${dateFrom} — ${dateTo}`,
    [
      { label: 'Дисциплина', value: (r) => r.disciplineName },
      { label: 'Группа', value: (r) => r.groupName },
      { label: 'Отменено занятий', value: (r) => r.cancelledCount },
      { label: 'Вычтено часов', value: (r) => r.cancelledHours },
    ],
    rows,
  )
  await printHtmlToPdf(html, filePath, false)
}

export async function printRoomUtilizationReportToPdf(tx: DbLike, dateFrom: string, dateTo: string, filePath: string): Promise<void> {
  const rows = roomUtilizationReport(tx, dateFrom, dateTo)
  const html = reportTableHtml(
    `Загрузка кабинетов ${dateFrom} — ${dateTo}`,
    [
      { label: 'Кабинет', value: (r) => r.roomLabel },
      { label: 'Занято пар', value: (r) => r.occupiedSlots },
      { label: 'Доступно пар', value: (r) => r.availableSlots },
      { label: 'Простой', value: (r) => PERCENT(r.idlePercent) },
    ],
    rows,
  )
  await printHtmlToPdf(html, filePath, false)
}
