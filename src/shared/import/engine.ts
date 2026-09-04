/**
 * Универсальный мастер импорта (§3.8): чистые функции без Electron/БД, работающие
 * над сырой сеткой ячеек. Ничего не знает про конкретный файл — три механизма ниже
 * (наследование контекста, фильтр служебных строк, разрешение расхождений) включаются
 * настройкой, а не зашиты под присланные образцы (решения п. 47).
 */
export type Cell = string | number | null
export type Grid = Cell[][]

function cellText(cell: Cell): string {
  return cell == null ? '' : String(cell).trim()
}

function cellNumber(cell: Cell): number | null {
  if (typeof cell === 'number') return cell
  // Excel в русской локали пишет часы как «1 234,5», причём разделителем разрядов бывает
  // не только пробел, но и неразрывный (U+00A0) или узкий неразрывный (U+202F). Без их
  // удаления Number() давал NaN, и часы молча пропадали из импорта как «пустая ячейка».
  const text = cellText(cell).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
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
    { field: 'lessonKind', labelRu: 'Вид занятия (лекция/практическое/семинар/лабораторное)', required: true },
    { field: 'hoursPlanned', labelRu: 'Часы', required: true },
  ],
  teacher: [
    { field: 'lastName', labelRu: 'Фамилия', required: true },
    { field: 'firstName', labelRu: 'Имя', required: true },
    { field: 'middleName', labelRu: 'Отчество', required: false },
    { field: 'categoryCode', labelRu: 'Категория (штат/внештат/почасовик)', required: false },
    { field: 'phone', labelRu: 'Телефон', required: false },
    { field: 'mainWorkplace', labelRu: 'Основное место работы', required: false },
    { field: 'availabilityNote', labelRu: 'Заметка о доступности', required: false },
  ],
  calendar_period: [
    { field: 'kind', labelRu: 'Тип периода (теория/практика/каникулы/сессия/ИГА/карантин)', required: true },
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

// ─────────────────────────────────────────────────────────────────────────────────────────
// Разбор значений-перечислений и дат (§3.8e)

/**
 * Приведение к ключу сравнения: регистр, ё/е и лишние пробелы в рабочих файлах гуляют
 * («Почасовик», «почасовик », «ПОЧАСОВИК»), и сравнение «как есть» отбивало нормальную
 * строку с «неизвестная категория».
 */
function normalizeKey(text: string): string {
  return text.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
}

/**
 * Значение перечисления из файла: сначала сам код (`hourly`), потом русское название из
 * словаря синонимов. Завуч ведёт файл по-русски и сопоставляет ту колонку, которую видит;
 * требовать от него колонку с латинским кодом — значит требовать готовить файл под
 * программу, тогда как мастер задуман наоборот (§3.8, §1.1 п.5).
 */
export function parseEnum<T extends string>(cell: Cell, codes: readonly T[], synonyms: Record<string, T>): T | null {
  const key = normalizeKey(cellText(cell))
  if (key === '') return null
  const byCode = codes.find((c) => c.toLowerCase() === key)
  if (byCode) return byCode
  return synonyms[key] ?? null
}

export const LESSON_KIND_SYNONYMS: Record<string, 'theory' | 'practice' | 'seminar' | 'lab'> = {
  'теоретическое': 'theory',
  'теория': 'theory',
  'теоретическое занятие': 'theory',
  'лекция': 'theory',
  'лекционное': 'theory',
  'лек.': 'theory',
  'лек': 'theory',
  'практическое': 'practice',
  'практика': 'practice',
  'практическое занятие': 'practice',
  'практ.': 'practice',
  'практ': 'practice',
  'семинарское': 'seminar',
  'семинар': 'seminar',
  'семинарское занятие': 'seminar',
  'сем.': 'seminar',
  'сем': 'seminar',
  'лабораторное': 'lab',
  'лабораторная': 'lab',
  'лаборатория': 'lab',
  'лабораторное занятие': 'lab',
  'лаб.': 'lab',
  'лаб': 'lab',
}

export const CALENDAR_KIND_SYNONYMS: Record<string, 'theory' | 'practice' | 'prequal_practice' | 'vacation' | 'session' | 'iga' | 'quarantine'> = {
  'теоретическое обучение': 'theory',
  'теория': 'theory',
  'практика': 'practice',
  'производственная практика': 'practice',
  'учебная практика': 'practice',
  'преддипломная практика': 'prequal_practice',
  'каникулы': 'vacation',
  'зимние каникулы': 'vacation',
  'летние каникулы': 'vacation',
  'сессия': 'session',
  'зимняя сессия': 'session',
  'летняя сессия': 'session',
  'экзаменационная сессия': 'session',
  'ига': 'iga',
  'итоговая государственная аттестация': 'iga',
  'государственная итоговая аттестация': 'iga',
  'карантин': 'quarantine',
}

export const TEACHER_CATEGORY_SYNONYMS: Record<string, 'staff' | 'external' | 'hourly'> = {
  'штат': 'staff',
  'штатный': 'staff',
  'штатная': 'staff',
  'основной': 'staff',
  'шт': 'staff',
  'внештат': 'external',
  'внештатный': 'external',
  'внештатная': 'external',
  'внешний совместитель': 'external',
  'совместитель': 'external',
  'внеш': 'external',
  'почасовик': 'hourly',
  'почасовой': 'hourly',
  'почасовая оплата': 'hourly',
  'почас': 'hourly',
}

/**
 * Дата из ячейки. Excel отдаёт настоящую дату уже как ГГГГ-ММ-ДД (см. workbook.ts), но
 * в рабочих файлах даты часто набраны текстом — «01.09.2026», «1.9.2026», «01/09/2026».
 * Раньше такие строки молча отбивались как «не указана дата», хотя в файле она есть.
 */
export function parseIsoDate(cell: Cell): string | null {
  const text = cellText(cell)
  if (text === '') return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const dmy = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(text)
  if (dmy) {
    const [, d, m, y] = dmy
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`
  }
  return null
}

/**
 * Совпадение ФИО из файла с парой «фамилия + имя» из справочника. В рабочих файлах имя
 * пишут по-разному: «Абдиева Жыпар», «Абдиева Жыпар Салтанатовна», «Абдиева Ж.» — и точное
 * сравнение с «Фамилия Имя» находило только первый вариант.
 */
export function matchesPersonName(cell: Cell, lastName: string, firstName: string): boolean {
  const parts = normalizeKey(cellText(cell)).split(' ').filter((p) => p !== '')
  if (parts.length < 2) return false
  if (parts[0] !== normalizeKey(lastName)) return false

  const given = normalizeKey(firstName)
  const second = parts[1]!.replace(/\.$/, '')
  return second === given || (second.length === 1 && given.startsWith(second))
}
