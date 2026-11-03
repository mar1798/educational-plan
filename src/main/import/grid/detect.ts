/**
 * Распознавание раскладки сводного расписания (§этап Ж) БЕЗ привязки к адресам ячеек: файл колледжа
 * могут перекомпоновать (добавить группу, сдвинуть шапку), и импорт не должен от этого ломаться
 * (решение п. 47 — format-agnostic).
 *
 * - строка шапки — та, где есть «День» и «Пары»;
 * - колонки групп — ячейки шапки, совпавшие с названиями групп справочника; повторные служебные
 *   колонки справа («Часы занятий | Пары | День») и зеркальные дубли групп пропускаются;
 * - блоки дней — по названию дня в колонке «День» (объединённая ячейка даёт то же значение в каждой строке);
 * - пара — это одна или две подряд идущие строки с одним номером: верхняя — дисциплина, нижняя — преподаватель.
 */
import type { Grid } from '../../../shared/import/engine'

export interface GridGroup {
  id: number
  name: string
}

export interface DetectedGroupColumn {
  col: number
  header: string
  groupId: number
}

export interface DetectedCell {
  dayOfWeek: number
  pairNo: number
  groupId: number
  groupName: string
  top: string
  bottom: string
  /** 1-based строка листа верхней строки пары — для сообщений об ошибках. */
  row: number
}

export interface DetectedLayout {
  /** 1-based строка шапки. */
  headerRow: number
  dayCol: number
  pairCol: number
  groupColumns: DetectedGroupColumn[]
  /** Заголовки, похожие на группы, но не найденные в справочнике. */
  unknownHeaders: string[]
  cells: DetectedCell[]
}

const DAY_PREFIX: [string, number][] = [
  ['пон', 1],
  ['вто', 2],
  ['сре', 3],
  ['чет', 4],
  ['пят', 5],
  ['суб', 6],
]

const SERVICE_HEADERS = new Set(['день', 'пары', 'пара', 'часы занятий', 'время'])

const norm = (v: unknown): string =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
/** Название группы без регистра, пробелов и разновидностей дефиса. */
const groupKey = (v: unknown): string =>
  norm(v)
    .toLowerCase()
    .replace(/[\s‐-―-]+/g, '')

function dayOf(value: unknown): number | null {
  const s = norm(value).toLowerCase()
  if (s === '') return null
  return DAY_PREFIX.find(([prefix]) => s.startsWith(prefix))?.[1] ?? null
}

function pairNoOf(value: unknown): number | null {
  const n = Number(norm(value).split(/\s/)[0])
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null
}

export function detectGridLayout(grid: Grid, groups: GridGroup[], opts: { headerRow?: number } = {}): DetectedLayout {
  const byKey = new Map(groups.map((g) => [groupKey(g.name), g]))

  let headerIdx = opts.headerRow != null ? opts.headerRow - 1 : -1
  if (headerIdx < 0) {
    headerIdx = grid.findIndex((row) => row.some((c) => norm(c).toLowerCase() === 'день') && row.some((c) => ['пары', 'пара'].includes(norm(c).toLowerCase())))
  }
  if (headerIdx < 0 || !grid[headerIdx]) {
    throw new Error('Не нашёл строку шапки: ожидаются колонки «День» и «Пары» над списком групп. Если шапка записана иначе, укажите её строку вручную')
  }

  const header = grid[headerIdx]!
  const dayCol = header.findIndex((c) => norm(c).toLowerCase() === 'день')
  const pairCol = header.findIndex((c) => ['пары', 'пара'].includes(norm(c).toLowerCase()))
  if (dayCol < 0 || pairCol < 0) throw new Error(`В строке ${headerIdx + 1} нет колонок «День» и «Пары»`)

  const groupColumns: DetectedGroupColumn[] = []
  const unknownHeaders: string[] = []
  const seen = new Set<number>()
  header.forEach((cell, col) => {
    const text = norm(cell)
    if (text === '' || SERVICE_HEADERS.has(text.toLowerCase())) return
    const group = byKey.get(groupKey(text))
    if (!group) {
      unknownHeaders.push(text)
      return
    }
    if (seen.has(group.id)) return // зеркальная колонка справа
    seen.add(group.id)
    groupColumns.push({ col, header: text, groupId: group.id })
  })

  const cells: DetectedCell[] = []
  let day: number | null = null
  let current: { pairNo: number; rows: number[] } | null = null
  const flush = () => {
    if (!current || day == null) return
    const [topRow, bottomRow] = current.rows
    for (const gc of groupColumns) {
      const top = norm(grid[topRow!]?.[gc.col])
      const bottom = bottomRow != null ? norm(grid[bottomRow]?.[gc.col]) : ''
      if (top === '') continue
      cells.push({ dayOfWeek: day, pairNo: current.pairNo, groupId: gc.groupId, groupName: groups.find((g) => g.id === gc.groupId)!.name, top, bottom, row: topRow! + 1 })
    }
    current = null
  }

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r]!
    const rowDay = dayOf(row[dayCol])
    const pairNo = pairNoOf(row[pairCol])
    if (rowDay != null && rowDay !== day) {
      flush()
      day = rowDay
    }
    if (day == null || pairNo == null) {
      // Строка без номера пары — подписи под таблицей («Согласовано: …»): блок закончился.
      if (rowDay == null) flush()
      continue
    }
    if (current && current.pairNo === pairNo && current.rows.length < 2) current.rows.push(r)
    else {
      flush()
      current = { pairNo, rows: [r] }
    }
  }
  flush()

  return { headerRow: headerIdx + 1, dayCol: dayCol + 1, pairCol: pairCol + 1, groupColumns, unknownHeaders, cells }
}
