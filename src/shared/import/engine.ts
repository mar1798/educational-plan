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
    // Годовая нагрузка держит оба полугодия в одной строке: с полугодием запись уходит в
    // семестр того же учебного года (§1.1 п.38), и файл загружается за один проход.
    { field: 'halfYear', labelRu: 'Полугодие (I/II)', required: false },
    // Нагрузке численность не нужна; по ней заводятся группы, которых ещё нет в справочнике.
    { field: 'studentsCount', labelRu: 'Численность группы (для новых групп)', required: false },
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
  /** Признаки записи колонки-значения: { lessonKind: 'лекция', halfYear: 'I' } — см. mapToEntity. */
  constants?: Record<string, string>
}

/** Поля, которые сопоставлены несколькими колонками сразу, — колонки-значения «широкой» таблицы. */
export function unpivotFields(columns: ColumnMapping[]): Set<string> {
  const counts = new Map<string, number>()
  for (const c of columns) counts.set(c.field, (counts.get(c.field) ?? 0) + 1)
  return new Set([...counts].filter(([, n]) => n > 1).map(([field]) => field))
}

/**
 * Сопоставление колонок → поля целевой сущности (§3.8), без знания о конкретных таблицах БД.
 *
 * Таблица бывает «широкой»: одна строка файла — пара «преподаватель × группа», а часы
 * разнесены по колонкам «Лек. I полугодие», «Практ. I полугодие», «Лек. II полугодие»…
 * Вид занятия и полугодие тогда записаны не в ячейке, а в шапке колонки. Если одно поле
 * сопоставлено нескольким колонкам, каждая из них даёт из строки отдельную запись, а
 * недостающие признаки берутся из `constants` колонки. Пустая ячейка и ноль в такой
 * колонке означают «записи нет»: иначе каждая строка рождала бы записи без часов.
 *
 * `contexts[i]` — значения из строк-заголовков блоков для `rows[i]` (applyBlockHeaders);
 * непустая ячейка самой строки важнее контекста, признак колонки-значения важнее обоих.
 */
export function mapToEntity(rows: Grid, columns: ColumnMapping[], contexts?: Record<string, Cell>[]): Record<string, Cell>[] {
  const unpivot = unpivotFields(columns)
  const base = columns.filter((c) => !unpivot.has(c.field))
  const values = columns.filter((c) => unpivot.has(c.field))

  const result: Record<string, Cell>[] = []
  rows.forEach((row, i) => {
    const own = Object.fromEntries(base.map((c) => [c.field, row[c.columnIndex] ?? null])) as Record<string, Cell>
    const record: Record<string, Cell> = { ...(contexts?.[i] ?? {}) }
    for (const [field, value] of Object.entries(own)) {
      if (cellText(value) !== '' || !(field in record)) record[field] = value
    }

    const hasOwn = Object.values(own).some((v) => cellText(v) !== '')
    if (values.length === 0) {
      if (hasOwn) result.push(record)
      return
    }
    // Строка, где заполнены только колонки-значения, — общий итог листа без подписи
    // («8298» под таблицей): без этой проверки он стал бы записью с контекстом последнего блока.
    if (base.length > 0 && !hasOwn) return
    for (const c of values) {
      const value = row[c.columnIndex] ?? null
      if (cellText(value) === '' || cellNumber(value) === 0) continue
      result.push({ ...record, ...(c.constants ?? {}), [c.field]: value })
    }
  })
  return result
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Строки-заголовки блоков

export interface BlockHeaderRule {
  /** Колонка-признак: по её значению строка узнаётся как заголовок блока. */
  columnIndex: number
  /** Регулярное выражение без учёта регистра; пустая строка — «любое непустое значение». */
  pattern: string
  /** Поле записи, которое заголовок задаёт всем строкам блока… */
  field: string
  /** …и колонка заголовка, из которой берётся значение. */
  sourceColumnIndex: number
}

export interface BlockHeaderResult {
  dataRows: Grid
  /** Контекст блока для каждой строки `dataRows`, в том же порядке. */
  contexts: Record<string, Cell>[]
  headerRows: Grid
}

/**
 * Строки-заголовки блоков (§3.8a): в годовой нагрузке дисциплина и преподаватель стоят не
 * в своих колонках, а отдельными строками над блоком групп — «1 | Хирургия», затем
 * «Янхаева З.», затем строки групп с пустой ячейкой. Причём дисциплина лежит в той же
 * колонке, что у строк данных группа, поэтому «пустая ячейка = значение выше» здесь
 * бессильно: нужно сначала узнать строку как заголовок, а значение взять из её колонки.
 *
 * Строка-заголовок в данные не попадает (в ней итоги блока, а не нагрузка). Правила —
 * уровни иерархии и приоритет в порядке списка: заголовок внешнего уровня сбрасывает
 * значения вложенных, иначе первая строка нового цикла унаследовала бы преподавателя прошлого.
 */
export function applyBlockHeaders(rows: Grid, rules: BlockHeaderRule[]): BlockHeaderResult {
  const compiled = rules.map((r) => ({ ...r, re: r.pattern.trim() === '' ? null : new RegExp(r.pattern, 'i') }))
  const dataRows: Grid = []
  const contexts: Record<string, Cell>[] = []
  const headerRows: Grid = []
  const context = new Map<number, Cell>()

  for (const row of rows) {
    // Срабатывает первое подходящее условие: «число» в колонке цикла подошло бы и под
    // «любое непустое» преподавателя, и номер цикла стал бы преподавателем. Правила с тем
    // же условием срабатывают вместе — так одна строка-заголовок задаёт несколько полей.
    const first = compiled.find((rule) => {
      const text = cellText(row[rule.columnIndex] ?? null)
      return text !== '' && (rule.re == null || rule.re.test(text))
    })
    const matched = first
      ? compiled.map((rule, level) => ({ rule, level })).filter(({ rule }) => rule.columnIndex === first.columnIndex && rule.pattern === first.pattern)
      : []
    if (matched.length === 0) {
      dataRows.push(row)
      const ctx: Record<string, Cell> = {}
      for (const [level, rule] of compiled.entries()) {
        if (context.has(level)) ctx[rule.field] = context.get(level) ?? null
      }
      contexts.push(ctx)
      continue
    }
    headerRows.push(row)
    const outermost = Math.min(...matched.map((m) => m.level))
    for (const level of [...context.keys()]) if (level > outermost) context.delete(level)
    for (const { rule, level } of matched) {
      const value = row[rule.sourceColumnIndex] ?? null
      context.set(level, typeof value === 'string' ? value.trim() : value)
    }
  }
  return { dataRows, contexts, headerRows }
}

/**
 * Подпись колонки из шапки самого файла. Без неё на шаге 4 колонки различались только
 * буквой, и сопоставлять приходилось вслепую. Шапка бывает многоуровневой («Нагрузка /
 * Лек. / I полугодие»), и каждый уровень значим: вид занятия в одной строке, полугодие
 * в другой. Берём все уровни сплошного блока строк прямо над данными — заголовок листа
 * («Годовая нагрузка на …») отделён от шапки пустой строкой и в подпись не попадает.
 */
export function columnHeaderHints(grid: Grid, dataStartRow: number, columnCount: number): string[] {
  const above = grid.slice(0, Math.max(0, dataStartRow - 1))
  let top = above.length
  while (top > 0 && (above[top - 1] ?? []).some((cell) => cellText(cell) !== '')) top--
  const block = above.slice(top)
  return Array.from({ length: columnCount }, (_, c) => {
    const levels: string[] = []
    for (const row of block) {
      const text = cellText(row[c] ?? null)
      if (text !== '' && !levels.includes(text)) levels.push(text)
    }
    return levels.join(' / ')
  })
}

/** Поля, которые получат значение: из колонки, из признака колонки-значения или из заголовка блока. */
export function coveredFields(columns: ColumnMapping[], rules: BlockHeaderRule[]): Set<string> {
  const unpivot = unpivotFields(columns)
  const covered = new Set<string>([...columns.map((c) => c.field), ...rules.map((r) => r.field)])
  const valueColumns = columns.filter((c) => unpivot.has(c.field))
  // Признак засчитывается, только если задан у каждой колонки-значения: иначе часть
  // записей уйдёт без него и будет отброшена при применении.
  if (valueColumns.length > 0) {
    const keys = new Set(valueColumns.flatMap((c) => Object.keys(c.constants ?? {})))
    for (const key of keys) {
      if (valueColumns.every((c) => cellText(c.constants?.[key] ?? null) !== '')) covered.add(key)
    }
  }
  return covered
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
  const parts = personNameTokens(cellText(cell))
  const surname = personNameTokens(lastName)
  if (surname.length === 0 || parts.length <= surname.length) return false
  // Фамилия бывает из нескольких слов: кыргызские «Омуркул кызы», «Закир уулу» в файле
  // сокращают до «Омуркул к. К.» — сравниваем столько слов, сколько их в справочнике.
  // Частицу узнаём только внутри фамилии: в «Иванова К. Т.» «К.» — инициал имени.
  if (surname.some((s, i) => canonicalNamePart(parts[i]!) !== canonicalNamePart(s))) return false

  const given = normalizeKey(firstName).replace(/\.$/, '')
  const token = parts[surname.length]!
  // «Ж.», «З.Д.», «М.Н» — инициалы: имя узнаётся по первой букве. Раньше «М.Н» без
  // финальной точки не считался инициалом, и преподаватель «не находился».
  if (token.includes('.') || token.length === 1) return given.startsWith(token[0]!)
  return token === given
}

const NAME_PARTICLES: Record<string, string> = { 'к.': 'кызы', 'у.': 'уулу' }

function canonicalNamePart(token: string): string {
  return NAME_PARTICLES[token] ?? token
}

function personNameTokens(text: string): string[] {
  return normalizeKey(text).split(' ').filter((p) => p !== '')
}

/** Полугодие из ячейки или признака колонки: «I», «II», «1», «2 полугодие», «II сем». */
export function parseHalfYear(cell: Cell): 1 | 2 | null {
  const text = normalizeKey(cellText(cell))
  const m = /^(ii|i|1|2)(\s|$|\.)/.exec(text)
  if (!m) return null
  return m[1] === 'ii' || m[1] === '2' ? 2 : 1
}

/**
 * Подсказка признаков колонки-значения по её шапке («Нагрузка / Лек. / I полугодие»):
 * мастер подставляет их, завуч проверяет и правит. Только предзаполнение — то, что
 * завуч оставил, применение проверит тем же parseEnum/parseHalfYear.
 */
export function guessColumnConstants(headerText: string): { lessonKind?: string; halfYear?: string } {
  const guess: { lessonKind?: string; halfYear?: string } = {}
  for (const part of headerText.split(/\s*\/\s*/)) {
    const first = part.split(',')[0] ?? ''
    if (guess.lessonKind == null && parseEnum(first, ['theory', 'practice', 'seminar', 'lab'], LESSON_KIND_SYNONYMS) != null) {
      guess.lessonKind = first.trim()
    }
    // Номер полугодия ищем в любом месте шапки: «Кол-во часов I полугодие».
    const half = /(?:^|\s)(ii|i|1|2)\s*(полугод|сем)/i.exec(part)
    if (guess.halfYear == null && half) guess.halfYear = half[1]!.toUpperCase() === 'II' || half[1] === '2' ? 'II' : 'I'
  }
  return guess
}
