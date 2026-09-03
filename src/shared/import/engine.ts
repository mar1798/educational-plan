/**
 * Универсальный мастер импорта (§3.8): чистые функции без Electron/БД, работающие
 * над сырой сеткой ячеек. Ничего не знает про конкретный файл — три механизма ниже
 * (наследование контекста, фильтр служебных строк, разрешение расхождений) включаются
 * настройкой, а не зашиты под образцы из patterns/ (§4.8, §1.1 п.47).
 */
export type Cell = string | number | null
export type Grid = Cell[][]

function cellText(cell: Cell): string {
  return cell == null ? '' : String(cell).trim()
}

function cellNumber(cell: Cell): number | null {
  if (typeof cell === 'number') return cell
  const text = cellText(cell).replace(',', '.')
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/**
 * «Пустая ячейка = значение строкой выше» для выбранных колонок (§3.8a) — разбирает
 * трёхуровневую иерархию «дисциплина → преподаватель → группы» из образца нагрузки.
 * Правило включается по колонке, а не зашито в код.
 *
 * Колонки считаются уровнями иерархии слева направо: новое значение во внешней колонке
 * сбрасывает запомненные значения вложенных. Иначе первая строка нового блока
 * «дисциплина» унаследовала бы преподавателя предыдущего блока — молча неверные данные
 * вместо пустой ячейки, которую применение импорта отбросит с понятной причиной.
 */
export function applyContextInheritance(rows: Grid, inheritColumnIndexes: number[]): Grid {
  const levels = [...inheritColumnIndexes].sort((a, b) => a - b)
  const last = new Map<number, Cell>()
  return rows.map((row) => {
    const next = [...row]
    for (const [level, col] of levels.entries()) {
      const value = next[col] ?? null
      if (cellText(value) === '') {
        next[col] = last.get(col) ?? null
      } else {
        last.set(col, value)
        for (const inner of levels.slice(level + 1)) last.delete(inner)
      }
    }
    return next
  })
}

export interface ServiceRowFilterResult {
  dataRows: Grid
  controlRows: Grid
}

/**
 * Строки «Итого / ВСЕГО» — не данные, а контрольные суммы (§3.8b): распознаются по
 * настраиваемому правилу (регулярное выражение или список слов через «|», без учёта
 * регистра), а не по номеру строки — в файле они перемешаны с данными.
 */
export function filterServiceRows(rows: Grid, pattern: string): ServiceRowFilterResult {
  if (pattern.trim() === '') return { dataRows: rows, controlRows: [] }
  const re = new RegExp(pattern, 'i')
  const dataRows: Grid = []
  const controlRows: Grid = []
  for (const row of rows) {
    const isControl = row.some((cell) => re.test(cellText(cell)))
    ;(isControl ? controlRows : dataRows).push(row)
  }
  return { dataRows, controlRows }
}

export interface TotalsReconciliation {
  columnIndex: number
  dataSum: number
  controlSum: number
  matches: boolean
}

/**
 * Сверка по контрольным суммам (§3.8b): сумма данных по колонке против суммы той же
 * колонки в строках «Итого». Расхождение только показывается — не блокирует импорт,
 * контрольные строки могут относиться к другому разрезу файла.
 */
export function reconcileTotals(dataRows: Grid, controlRows: Grid, sumColumnIndexes: number[]): TotalsReconciliation[] {
  return sumColumnIndexes.map((columnIndex) => {
    const dataSum = dataRows.reduce((acc, row) => acc + (cellNumber(row[columnIndex] ?? null) ?? 0), 0)
    const controlSum = controlRows.reduce((acc, row) => acc + (cellNumber(row[columnIndex] ?? null) ?? 0), 0)
    return { columnIndex, dataSum, controlSum, matches: Math.abs(dataSum - controlSum) < 1e-9 }
  })
}

export interface DiscrepancyGroup {
  key: string
  values: { value: string; count: number }[]
}

/**
 * Один объект пришёл с разными значениями (§3.8c) — например, численность группы
 * записана как 17 в шести строках и 30 в девяти. Возвращает только реальные
 * расхождения (ключи с более чем одним различным значением), с частотой по каждому.
 */
export function collectDiscrepancies(rows: Grid, keyColumnIndexes: number[], valueColumnIndex: number): DiscrepancyGroup[] {
  const byKey = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const key = keyColumnIndexes.map((c) => cellText(row[c] ?? null)).join(' / ')
    if (key.trim() === '') continue
    const value = cellText(row[valueColumnIndex] ?? null)
    if (value === '') continue
    const counts = byKey.get(key) ?? new Map<string, number>()
    counts.set(value, (counts.get(value) ?? 0) + 1)
    byKey.set(key, counts)
  }

  const result: DiscrepancyGroup[] = []
  for (const [key, counts] of byKey) {
    if (counts.size <= 1) continue
    result.push({
      key,
      values: [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
    })
  }
  return result
}

/**
 * Применяет выбор завуча из экрана «Расхождения в файле» (§3.8c): переписывает
 * значение колонки во всех строках объекта на выбранное — без этого шага импорт
 * не должен применяться, если collectDiscrepancies вернул хоть одну группу.
 */
export function resolveDiscrepancies(rows: Grid, keyColumnIndexes: number[], valueColumnIndex: number, resolutions: Record<string, string>): Grid {
  return rows.map((row) => {
    const key = keyColumnIndexes.map((c) => cellText(row[c] ?? null)).join(' / ')
    const resolved = resolutions[key]
    if (resolved == null) return row
    const next = [...row]
    next[valueColumnIndex] = resolved
    return next
  })
}

export type TargetEntity = 'curriculum' | 'teaching_load' | 'teacher' | 'calendar_period'

export interface TargetFieldSpec {
  field: string
  labelRu: string
  required: boolean
}

/**
 * Целевые схемы импорта (§3.8e): мастер знает, какие поля нужны каждой сущности,
 * и подсказывает при сопоставлении колонок — разбор самих колонок остаётся
 * настраиваемым (не привязан к тому, в каком порядке они идут в файле).
 */
export const TARGET_SCHEMAS: Record<TargetEntity, TargetFieldSpec[]> = {
  curriculum: [
    { field: 'disciplineName', labelRu: 'Дисциплина', required: true },
    { field: 'course', labelRu: 'Курс', required: true },
    { field: 'semesterNo', labelRu: 'Семестр плана', required: true },
    { field: 'credits', labelRu: 'Кредиты', required: true },
    { field: 'hoursTotal', labelRu: 'Всего часов', required: true },
    { field: 'hoursClassroom', labelRu: 'Аудиторных часов', required: true },
    { field: 'hoursTheory', labelRu: 'Теоретических часов', required: false },
    { field: 'hoursPractice', labelRu: 'Практических часов', required: false },
    { field: 'hoursSeminar', labelRu: 'Семинарских часов', required: false },
    { field: 'hoursLab', labelRu: 'Лабораторных часов', required: false },
    { field: 'hoursSrs', labelRu: 'СРС', required: false },
    { field: 'controlSemester', labelRu: 'Семестр итогового контроля', required: false },
  ],
  teaching_load: [
    { field: 'teacherName', labelRu: 'Преподаватель (Фамилия Имя)', required: true },
    { field: 'groupName', labelRu: 'Группа', required: true },
    { field: 'disciplineName', labelRu: 'Дисциплина', required: true },
    { field: 'lessonKind', labelRu: 'Вид занятия (theory/practice/seminar/lab)', required: true },
    { field: 'hoursPlanned', labelRu: 'Часы', required: true },
  ],
  teacher: [
    { field: 'lastName', labelRu: 'Фамилия', required: true },
    { field: 'firstName', labelRu: 'Имя', required: true },
    { field: 'middleName', labelRu: 'Отчество', required: false },
    { field: 'categoryCode', labelRu: 'Категория (staff/external/hourly)', required: false },
    { field: 'phone', labelRu: 'Телефон', required: false },
    { field: 'mainWorkplace', labelRu: 'Основное место работы', required: false },
  ],
  calendar_period: [
    { field: 'kind', labelRu: 'Тип периода (theory/practice/prequal_practice/vacation/session/iga/quarantine)', required: true },
    { field: 'course', labelRu: 'Курс', required: false },
    { field: 'startsOn', labelRu: 'Дата начала (ГГГГ-ММ-ДД)', required: true },
    { field: 'endsOn', labelRu: 'Дата окончания (ГГГГ-ММ-ДД)', required: true },
    { field: 'note', labelRu: 'Заметка', required: false },
  ],
}

export interface ColumnMapping {
  columnIndex: number
  field: string
}

/** Сопоставление колонок → поля целевой сущности (§3.8), без знания о конкретных таблицах БД. */
export function mapToEntity(rows: Grid, columns: ColumnMapping[]): Record<string, Cell>[] {
  return rows
    .map((row) => Object.fromEntries(columns.map((c) => [c.field, row[c.columnIndex] ?? null])))
    .filter((obj) => Object.values(obj).some((v) => cellText(v) !== ''))
}

export { cellNumber, cellText }
