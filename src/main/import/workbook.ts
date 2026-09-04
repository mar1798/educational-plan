import ExcelJS from 'exceljs'
import type { Cell, Grid } from '../../shared/import/engine'

export interface SheetInfo {
  name: string
  rowCount: number
  columnCount: number
}

function cellValueToPrimitive(value: ExcelJS.CellValue): Cell {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    // Формула (обычная или общая, sharedFormula) — берём вычисленный результат.
    // Книга может не хранить кэш результата (формула ссылается на пустые ячейки) —
    // тогда результата нет, а не строка «[object Object]».
    if ('result' in value) return cellValueToPrimitive((value as ExcelJS.CellFormulaValue).result ?? null)
    if ('formula' in value || 'sharedFormula' in value) return null
    if ('richText' in value) return (value as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('')
    if ('text' in value) return String((value as { text: unknown }).text)
  }
  return String(value)
}

/** Список листов книги (шаг 2 мастера, §3.8) — любой xlsx, без знания о его содержимом. */
export async function listSheets(filePath: string): Promise<SheetInfo[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  return workbook.worksheets.map((ws) => ({ name: ws.name, rowCount: ws.rowCount, columnCount: ws.columnCount }))
}

/** Сырые ячейки листа как сетка строк (шаги 3–4 мастера) — дальше её разбирает engine.ts. */
export async function readSheetGrid(filePath: string, sheetName: string): Promise<Grid> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const sheet = workbook.getWorksheet(sheetName)
  if (!sheet) throw new Error(`Лист «${sheetName}» не найден в файле`)

  // `rowCount` и `columnCount` в ExcelJS — не поля, а геттеры: `columnCount` на каждое
  // обращение прогоняет `eachRow` по всему листу. В условии внутреннего цикла он вычислялся
  // на каждой ячейке, и обход листа становился кубическим (строки × колонки × строки):
  // «Годовая нагрузка» на 5000+ строк не дочитывалась и за десять минут, полностью
  // заблокировав main-процесс на шаге «Загрузка листа…».
  const rowCount = sheet.rowCount
  const columnCount = sheet.columnCount

  const grid: Grid = []
  for (let r = 1; r <= rowCount; r++) {
    const row = sheet.getRow(r)
    const cells: Cell[] = []
    for (let c = 1; c <= columnCount; c++) {
      cells.push(cellValueToPrimitive(row.getCell(c).value))
    }
    grid.push(cells)
  }
  return grid
}
