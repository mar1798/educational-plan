import ExcelJS from 'exceljs'
import type { Db } from '../../src/main/db/client'
import { ensureTeacherCategories } from '../../src/main/db/repo/seed'
import * as schema from '../../src/main/db/schema'
import {
  applyBlockHeaders,
  applyContextInheritance,
  collectDiscrepancies,
  columnHeaderHints,
  filterServiceRows,
  mapToEntity,
  resolveDiscrepancies,
  type ColumnMapping,
  type Grid,
} from '../../src/shared/import/engine'
import { IMPORT_PRESETS, type SavedMapping } from '../../src/shared/import/presets'

// Общее для регресса годовой нагрузки (import-annual-load.test.ts) и для ручного прогона
// мастера в приложении: поставляемый профиль, цепочка мастера и пустой учебный год.

export const COL = { B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11, M: 12, N: 13, O: 14, P: 15, Q: 16, R: 17 }

/** Поставляемый профиль «Годовая нагрузка» — тот, что завуч выбирает в мастере. */
export const annualLoadMapping: SavedMapping = IMPORT_PRESETS.find((p) => p.key === 'annual-load')!.mapping

/**
 * Та же цепочка, что пересчитывает предпросмотр мастера (ImportWizardPage): диапазон →
 * служебные строки → наследование → строки-заголовки → расхождения → записи.
 * `resolutions` — выбор завуча в «Проверке расхождений» (ключ — значение колонки-ключа).
 */
export function buildRecords(grid: Grid, mapping: SavedMapping, resolutions: Record<string, string> = {}) {
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0)
  const hints = columnHeaderHints(grid, mapping.dataStartRow, width)
  const columns: ColumnMapping[] = mapping.columns
    .map((c, i) => ({ columnIndex: i, field: c.field, constants: c.constants }))
    .filter((c) => c.field !== '')
  const inherit = mapping.columns.map((c, i) => (c.inherit ? i : -1)).filter((i) => i >= 0)
  const ranged = grid.slice(mapping.dataStartRow - 1, mapping.dataEndRow ?? grid.length)
  const { dataRows: afterService } = filterServiceRows(ranged, mapping.servicePattern)
  const blocks = applyBlockHeaders(applyContextInheritance(afterService, inherit), mapping.headerRules ?? [])
  const check = mapping.discrepancy
  const discrepancies = check ? collectDiscrepancies(blocks.dataRows, [check.keyColumn], check.valueColumn) : []
  const resolved = check ? resolveDiscrepancies(blocks.dataRows, [check.keyColumn], check.valueColumn, resolutions) : blocks.dataRows
  return { hints, columns, blocks, discrepancies, records: mapToEntity(resolved, columns, blocks.contexts) }
}

/** Как поступил бы завуч, не вникая: в каждом расхождении — самое частое значение. */
export function mostFrequent(discrepancies: ReturnType<typeof collectDiscrepancies>): Record<string, string> {
  return Object.fromEntries(discrepancies.map((d) => [d.key, d.values[0]!.value]))
}

/**
 * Состояние базы, с которым завуч приходит к импорту в онбординге: учебный год с двумя
 * семестрами и категории преподавателей (их заводит каждый запуск). Больше ничего.
 */
export function seedEmptyYear(db: Db) {
  ensureTeacherCategories(db)
  const yearId = db.insert(schema.academicYear).values({ name: '2026/2027', startsOn: '2026-09-01', endsOn: '2027-06-30' }).returning().get().id
  const sem1 = db.insert(schema.semester).values({ academicYearId: yearId, no: 1, startsOn: '2026-09-01', endsOn: '2027-01-15' }).returning().get().id
  const sem2 = db.insert(schema.semester).values({ academicYearId: yearId, no: 2, startsOn: '2027-02-01', endsOn: '2027-06-30' }).returning().get().id
  return { sem1, sem2 }
}

/** Книга той же формы, что «Годовая нагрузка»: выдуманные люди, настоящая структура. */
export async function writeAnnualLoadWorkbook(path: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Бюджет')
  ws.getCell('B2').value = 'Годовая нагрузка преподавателей'
  ws.mergeCells('B2:S2')
  ws.getCell('B3').value = 'на 2026-2027 учебный год (бюджет)'
  ws.mergeCells('B3:S3')

  // Трёхуровневая шапка на объединённых ячейках.
  ws.getCell('B5').value = 'Ф.И.О.'
  ws.mergeCells('B5:C6')
  ws.getCell('D5').value = 'Группа'
  ws.mergeCells('D5:D7')
  ws.getCell('E5').value = 'Кол-во ст.'
  ws.mergeCells('E5:E7')
  ws.getCell('F5').value = 'Подг'
  ws.mergeCells('F5:F7')
  for (const [start, end, sum, half] of [
    ['G', 'H', 'I', 'I полугодие'],
    ['M', 'N', 'O', 'II полугодие'],
  ] as const) {
    ws.getCell(`${start}5`).value = 'Нагрузка'
    ws.mergeCells(`${start}5:${end}5`)
    ws.getCell(`${start}6`).value = 'Лек.'
    ws.getCell(`${end}6`).value = 'Практ., семин., лаб.'
    ws.getCell(`${start}7`).value = half
    ws.mergeCells(`${start}7:${sum}7`)
    ws.getCell(`${sum}5`).value = `Кол-во часов ${half}`
  }
  ws.getCell('B7').value = '№'
  ws.mergeCells('B7:C7')

  let r = 8
  const cycle = (no: number, name: string) => {
    ws.getCell(`B${r}`).value = no
    ws.mergeCells(`B${r}:C${r}`)
    ws.getCell(`D${r}`).value = name
    ws.mergeCells(`D${r}:F${r}`)
    ws.getCell(`G${r}`).value = 999 // итог цикла — не нагрузка
    r++
  }
  const teacherRow = (name: string) => {
    ws.getCell(`B${r}`).value = name
    ws.mergeCells(`B${r}:D${r}`)
    ws.getCell(`G${r}`).value = 555
    r++
  }
  const group = (no: number, name: string, lec1: number | null, pr1: number | null, lec2: number | null, pr2: number | null) => {
    ws.getCell(`C${r}`).value = no
    ws.getCell(`D${r}`).value = name
    ws.getCell(`E${r}`).value = 20
    ws.getCell(`F${r}`).value = 2
    ws.getCell(`G${r}`).value = lec1
    ws.getCell(`H${r}`).value = pr1
    ws.getCell(`M${r}`).value = lec2
    // Формула с кэшем результата — так в реальном файле записана половина ячеек.
    ws.getCell(`N${r}`).value = pr2 == null ? null : { formula: `${pr2}`, result: pr2 }
    r++
  }

  cycle(1, 'Хирургия')
  teacherRow('Янхаева З.')
  group(1, 'СД-21', null, null, 24, 36)
  group(2, 'СД-31 ', 12, 33, 12, 33)
  teacherRow('Омуркул к. К.')
  group(1, 'АД-21', 18, null, 0, null)
  cycle(2, 'Терапия')
  teacherRow('Абдуллаева М.Н')
  group(1, 'СД-12', null, 12, null, null)
  group(1, 'СД-12', null, 12, null, null) // подгруппа второй строкой
  r += 2
  // Общий итог листа без подписи: профиль читает до конца листа, и записью он стать не должен.
  ws.getCell(`G${r}`).value = 8298
  await wb.xlsx.writeFile(path)
}
