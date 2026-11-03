import { describe, expect, it } from 'vitest'
import { detectGridLayout } from '../../src/main/import/grid/detect'
import type { Grid } from '../../src/shared/import/engine'

const groups = [
  { id: 1, name: 'КФ-11' },
  { id: 2, name: 'СД-11' },
]

/** Раскладка колледжа: шапка не в первой строке, служебные колонки зеркально, по две строки на пару. */
function sample(): Grid {
  const g: Grid = []
  g.push(['Расписание на 2026-2027 учебный год', null, null, null, null, null, null, null])
  g.push([null, null, null, null, null, null, null, 'Утверждаю: директор ____'])
  g.push(['День', 'Пары', 'Часы занятий', 'КФ-11', 'СД-11', 'Часы занятий', 'Пары', 'День'])
  const row = (day: string, pair: number | null, time: string, a: string, b: string): Grid[number] => [day, pair, time, a || null, b || null, time, pair, day]
  g.push(row('Понедельник', 1, '08:00–09:30', 'Анатомия', 'Ист. КР /'))
  g.push(row('Понедельник', 1, '08:00–09:30', 'Иванов И.', 'Петров П. /'))
  g.push(row('Понедельник', 2, '09:35–11:05', '', ''))
  g.push(row('Понедельник', 2, '09:35–11:05', '', ''))
  g.push(row('Вторник', 1, '08:00–09:30', '', 'I Офт.'))
  g.push(row('Вторник', 1, '08:00–09:30', '', 'Сидоров О.'))
  g.push(['Согласовано: зам. директора ____', null, null, null, null, null, null, null])
  return g
}

describe('распознавание раскладки сводного расписания (этап Ж)', () => {
  it('находит шапку, колонки групп без зеркальных дублей и ячейки пар', () => {
    const layout = detectGridLayout(sample(), groups)
    expect(layout.headerRow).toBe(3)
    expect(layout.groupColumns.map((c) => [c.header, c.groupId, c.col])).toEqual([['КФ-11', 1, 3], ['СД-11', 2, 4]])
    expect(layout.unknownHeaders).toEqual([])
    expect(layout.cells.map((c) => [c.dayOfWeek, c.pairNo, c.groupName, c.top, c.bottom])).toEqual([
      [1, 1, 'КФ-11', 'Анатомия', 'Иванов И.'],
      [1, 1, 'СД-11', 'Ист. КР /', 'Петров П. /'],
      [2, 1, 'СД-11', 'I Офт.', 'Сидоров О.'],
    ])
  })

  it('не привязан к адресам: лишние строки над шапкой и другой порядок групп', () => {
    const grid = sample()
    grid.unshift([null, null, null, null, null, null, null, null])
    for (const row of grid) [row[3], row[4]] = [row[4], row[3]]
    const layout = detectGridLayout(grid, groups)
    expect(layout.headerRow).toBe(4)
    expect(layout.groupColumns.map((c) => c.header)).toEqual(['СД-11', 'КФ-11'])
    expect(layout.cells).toHaveLength(3)
  })

  it('название группы сравнивается без регистра, пробелов и вида дефиса', () => {
    const grid = sample()
    grid[2]![3] = 'кф – 11'
    expect(detectGridLayout(grid, groups).groupColumns[0]!.groupId).toBe(1)
  })

  it('неизвестные заголовки попадают в отчёт', () => {
    const grid = sample()
    grid[2]![4] = 'ЛД-99'
    const layout = detectGridLayout(grid, groups)
    expect(layout.unknownHeaders).toEqual(['ЛД-99'])
    expect(layout.groupColumns).toHaveLength(1)
  })

  it('нет шапки — понятная ошибка; шапку можно указать вручную', () => {
    const grid: Grid = [['Группа', 'A'], ['x', 'y']]
    expect(() => detectGridLayout(grid, groups)).toThrow(/Не нашёл строку шапки/)
    expect(() => detectGridLayout(grid, groups, { headerRow: 1 })).toThrow(/нет колонок/)
    expect(detectGridLayout(sample(), groups, { headerRow: 3 }).cells).toHaveLength(3)
  })

  it('подписи под таблицей не становятся парами', () => {
    const grid = sample()
    grid.push(['Вторник', null, null, 'мусор', null, null, null, null])
    expect(detectGridLayout(grid, groups).cells).toHaveLength(3)
  })
})
