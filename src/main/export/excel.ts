/**
 * Экспорт расписания в Excel (§5.10 PLAN.md): расписание группы, преподавателя и сводное
 * (по всем группам, отдельный лист на группу) — на основе уже разрешённых имён из
 * `templateEntriesView` (§4.6), тем же представлением, что видит экран шаблона недели.
 */
import ExcelJS from 'exceljs'
import { eq } from 'drizzle-orm'
import { templateEntriesView, type TemplateEntryView } from '../db/repo/schedule-template'
import { deductedHoursReport, roomUtilizationReport, teacherLoadReport } from '../db/repo/reports'
import { pairGrid } from '../db/schema/org'
import { studyGroup } from '../db/schema/people'
import type { DbLike } from '../db/repo/types'

const WEEKDAY_LABEL: Record<number, string> = {
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
  6: 'Суббота',
}

const PARITY_SUFFIX: Record<TemplateEntryView['weekParity'], string> = { all: '', odd: ' (нечёт. нед.)', even: ' (чёт. нед.)' }

function enabledPairNumbers(tx: DbLike): number[] {
  const rows = tx.select().from(pairGrid).all()
  // ensurePairGrid() гарантирует непустую сетку при старте приложения (§2.8) — пустой
  // список здесь означает вызов вне обычного бутстрапа (например, напрямую в тесте).
  if (rows.length === 0) return [1, 2, 3, 4, 5, 6]
  return rows
    .filter((p) => p.enabled)
    .sort((a, b) => a.pairNo - b.pairNo)
    .map((p) => p.pairNo)
}

function cellText(entries: TemplateEntryView[]): string {
  return entries
    .map((e) => {
      const who = e.attendees.map((a) => (a.subgroupNo != null ? `${a.groupName} п/гр ${a.subgroupNo}` : a.groupName)).join(', ')
      const room = e.roomLabel ? ` · ауд. ${e.roomLabel}` : ''
      return `${e.disciplineName}${PARITY_SUFFIX[e.weekParity]}\n${e.teacherName} · ${who}${room}`
    })
    .join('\n———\n')
}

/**
 * Имя листа Excel: до 31 символа, без `* ? : \ / [ ]` и не повторяющееся — иначе ExcelJS
 * роняет весь экспорт на середине (в сводном файле листы называются по именам групп).
 */
function sheetName(workbook: ExcelJS.Workbook, title: string): string {
  const base = title.replace(/[*?:\\/[\]]/g, ' ').trim().slice(0, 31) || 'Лист'
  let name = base
  let n = 2
  while (workbook.getWorksheet(name) != null) {
    const suffix = ` (${n++})`
    name = base.slice(0, 31 - suffix.length) + suffix
  }
  return name
}

function buildGridSheet(workbook: ExcelJS.Workbook, title: string, entries: TemplateEntryView[], pairNumbers: number[]): void {
  const sheet = workbook.addWorksheet(sheetName(workbook, title))
  sheet.mergeCells(1, 1, 1, 7)
  sheet.getCell(1, 1).value = title
  sheet.getCell(1, 1).font = { bold: true, size: 14 }

  sheet.getCell(2, 1).value = 'Пара'
  for (let day = 1; day <= 6; day++) sheet.getCell(2, day + 1).value = WEEKDAY_LABEL[day]
  sheet.getRow(2).font = { bold: true }
  sheet.getRow(2).alignment = { horizontal: 'center' }

  let row = 3
  for (const pairNo of pairNumbers) {
    sheet.getCell(row, 1).value = pairNo
    sheet.getCell(row, 1).alignment = { vertical: 'top', horizontal: 'center' }
    for (let day = 1; day <= 6; day++) {
      const cell = sheet.getCell(row, day + 1)
      cell.value = cellText(entries.filter((e) => e.dayOfWeek === day && e.pairNo === pairNo))
      cell.alignment = { wrapText: true, vertical: 'top' }
    }
    row++
  }

  sheet.getColumn(1).width = 6
  for (let day = 1; day <= 6; day++) sheet.getColumn(day + 1).width = 30
  for (let r = 3; r < row; r++) sheet.getRow(r).height = 70
}

export async function exportGroupScheduleExcel(tx: DbLike, templateId: number, groupId: number, filePath: string): Promise<void> {
  const entries = templateEntriesView(tx, templateId).filter((e) => e.attendees.some((a) => a.groupId === groupId))
  const group = tx.select().from(studyGroup).where(eq(studyGroup.id, groupId)).get()
  const workbook = new ExcelJS.Workbook()
  buildGridSheet(workbook, `Расписание ${group?.name ?? `#${groupId}`}`, entries, enabledPairNumbers(tx))
  await workbook.xlsx.writeFile(filePath)
}

export async function exportTeacherScheduleExcel(tx: DbLike, templateId: number, teacherId: number, filePath: string): Promise<void> {
  const entries = templateEntriesView(tx, templateId).filter((e) => e.teacherId === teacherId)
  const workbook = new ExcelJS.Workbook()
  const title = entries[0]?.teacherName ?? `Преподаватель #${teacherId}`
  buildGridSheet(workbook, `Расписание — ${title}`, entries, enabledPairNumbers(tx))
  await workbook.xlsx.writeFile(filePath)
}

/** Сводное расписание колледжа: отдельный лист на каждую группу, встречающуюся в шаблоне. */
export async function exportSummaryScheduleExcel(tx: DbLike, templateId: number, filePath: string): Promise<void> {
  const entries = templateEntriesView(tx, templateId)
  const groupIds = [...new Set(entries.flatMap((e) => e.attendees.map((a) => a.groupId)))]
  const pairNumbers = enabledPairNumbers(tx)

  const workbook = new ExcelJS.Workbook()
  if (groupIds.length === 0) {
    buildGridSheet(workbook, 'Сводное расписание', [], pairNumbers)
  }
  for (const groupId of groupIds) {
    const group = tx.select().from(studyGroup).where(eq(studyGroup.id, groupId)).get()
    const groupEntries = entries.filter((e) => e.attendees.some((a) => a.groupId === groupId))
    buildGridSheet(workbook, group?.name ?? `#${groupId}`, groupEntries, pairNumbers)
  }
  await workbook.xlsx.writeFile(filePath)
}

/** Простая табличная страница (заголовок + строки) — общий вид для трёх отчётов этапа 7. */
interface TableColumn<T> {
  label: string
  width: number
  value: (row: T) => string | number
}

function buildTableSheet<T>(workbook: ExcelJS.Workbook, title: string, columns: TableColumn<T>[], rows: T[]): void {
  const sheet = workbook.addWorksheet(sheetName(workbook, title))
  sheet.mergeCells(1, 1, 1, columns.length)
  sheet.getCell(1, 1).value = title
  sheet.getCell(1, 1).font = { bold: true, size: 14 }

  columns.forEach((c, i) => {
    sheet.getCell(2, i + 1).value = c.label
    sheet.getColumn(i + 1).width = c.width
  })
  sheet.getRow(2).font = { bold: true }

  rows.forEach((row, rowIdx) => {
    columns.forEach((c, colIdx) => {
      sheet.getCell(rowIdx + 3, colIdx + 1).value = c.value(row)
    })
  })
}

const PERCENT = (n: number): string => `${Math.round(n * 100)}%`

/** Отчёт «Выполнение нагрузки» (§этап 7, §1.1 п.22/25/36/39). */
export async function exportTeacherLoadReportExcel(tx: DbLike, academicYearId: number, filePath: string): Promise<void> {
  const rows = teacherLoadReport(tx, academicYearId)
  const workbook = new ExcelJS.Workbook()
  buildTableSheet(
    workbook,
    'Выполнение нагрузки',
    [
      { label: 'Преподаватель', width: 30, value: (r) => r.teacherName },
      { label: 'Категория', width: 18, value: (r) => r.categoryTitle },
      { label: 'План, ч', width: 12, value: (r) => r.planHours },
      { label: 'Факт, ч', width: 12, value: (r) => r.factHours },
      { label: 'Прочие часы, ч', width: 14, value: (r) => r.otherHours },
      { label: 'Итого, ч', width: 12, value: (r) => r.totalHours },
      { label: 'Норма, ч', width: 12, value: (r) => r.normHoursYear ?? '—' },
      { label: 'Недоработка, ч', width: 14, value: (r) => r.shortfallHours ?? '—' },
    ],
    rows,
  )
  await workbook.xlsx.writeFile(filePath)
}

/** Отчёт «Вычтенные часы» по дисциплине и группе (§этап 7). */
export async function exportDeductedHoursReportExcel(tx: DbLike, dateFrom: string, dateTo: string, filePath: string): Promise<void> {
  const rows = deductedHoursReport(tx, dateFrom, dateTo)
  const workbook = new ExcelJS.Workbook()
  buildTableSheet(
    workbook,
    `Вычтенные часы ${dateFrom} — ${dateTo}`,
    [
      { label: 'Дисциплина', width: 32, value: (r) => r.disciplineName },
      { label: 'Группа', width: 16, value: (r) => r.groupName },
      { label: 'Отменено занятий', width: 18, value: (r) => r.cancelledCount },
      { label: 'Вычтено часов', width: 16, value: (r) => r.cancelledHours },
    ],
    rows,
  )
  await workbook.xlsx.writeFile(filePath)
}

/** Отчёт «Загрузка кабинетов» (§этап 7). */
export async function exportRoomUtilizationReportExcel(tx: DbLike, dateFrom: string, dateTo: string, filePath: string): Promise<void> {
  const rows = roomUtilizationReport(tx, dateFrom, dateTo)
  const workbook = new ExcelJS.Workbook()
  buildTableSheet(
    workbook,
    `Загрузка кабинетов ${dateFrom} — ${dateTo}`,
    [
      { label: 'Кабинет', width: 16, value: (r) => r.roomLabel },
      { label: 'Занято пар', width: 14, value: (r) => r.occupiedSlots },
      { label: 'Доступно пар', width: 14, value: (r) => r.availableSlots },
      { label: 'Простой', width: 12, value: (r) => PERCENT(r.idlePercent) },
    ],
    rows,
  )
  await workbook.xlsx.writeFile(filePath)
}
