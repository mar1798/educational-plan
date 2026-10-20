import { describe, expect, it } from 'vitest'
import {
  applyBlockHeaders,
  applyContextInheritance,
  collectDiscrepancies,
  coveredFields,
  filterServiceRows,
  guessColumnConstants,
  mapToEntity,
  matchesPersonName,
  parseHalfYear,
  reconcileTotals,
  resolveDiscrepancies,
  TARGET_SCHEMAS,
  type Grid,
} from '../../src/shared/import/engine'

// Фикстуры ниже смоделированы по структуре присланных образцов: иерархия
// «дисциплина → преподаватель → группы» из пустых ячеек, строки «Итого» вперемешку
// с данными, противоречивая численность одной и той же группы. Это тестовый материал
// сложности, а не спецификация парсера — импорт остаётся format-agnostic (решения п. 47).

describe('наследование контекста: пустая ячейка = значение строкой выше (§3.8a)', () => {
  it('разбирает трёхуровневую иерархию «дисциплина → преподаватель → группы»', () => {
    const rows: Grid = [
      ['Хирургия', '', '', ''],
      ['', 'Жакыпбеков К.Ш.', '', ''],
      ['', '', 'СД-21', 20],
      ['', '', 'АД-21', 13],
      ['Терапия', '', '', ''],
      ['', 'Петров С.', '', ''],
      ['', '', 'ЛД-31', 18],
    ]
    const filled = applyContextInheritance(rows, [0, 1])
    expect(filled.map((r) => [r[0], r[1], r[2], r[3]])).toEqual([
      ['Хирургия', null, '', ''],
      ['Хирургия', 'Жакыпбеков К.Ш.', '', ''],
      ['Хирургия', 'Жакыпбеков К.Ш.', 'СД-21', 20],
      ['Хирургия', 'Жакыпбеков К.Ш.', 'АД-21', 13],
      ['Терапия', null, '', ''],
      ['Терапия', 'Петров С.', '', ''],
      ['Терапия', 'Петров С.', 'ЛД-31', 18],
    ])
  })

  it('новая дисциплина сбрасывает унаследованного преподавателя предыдущего блока', () => {
    const rows: Grid = [
      ['Хирургия', 'Жакыпбеков К.Ш.', 'СД-21', 20],
      ['Терапия', '', 'ЛД-31', 18],
      ['', '', 'ЛД-32', 12],
    ]
    const filled = applyContextInheritance(rows, [0, 1])
    // Преподаватель терапии в файле не указан — это пустая ячейка, а не хирург из строки выше:
    // строка будет пропущена при применении с понятной причиной (§3.8).
    expect(filled.map((r) => [r[0], r[1], r[2]])).toEqual([
      ['Хирургия', 'Жакыпбеков К.Ш.', 'СД-21'],
      ['Терапия', null, 'ЛД-31'],
      ['Терапия', null, 'ЛД-32'],
    ])
  })

  it('колонки без наследования остаются как есть', () => {
    const rows: Grid = [
      ['A', 1],
      ['', 2],
    ]
    expect(applyContextInheritance(rows, [])).toEqual(rows)
  })
})

describe('фильтр служебных строк «Итого/ВСЕГО» (§3.8b)', () => {
  it('отделяет строки-суммы от данных по настраиваемому правилу', () => {
    const rows: Grid = [
      ['СД-21', 20],
      ['АД-21', 13],
      ['Итого:', 33],
      ['ЛД-31', 18],
      ['ВСЕГО:', 51],
    ]
    const { dataRows, controlRows } = filterServiceRows(rows, 'итого|всего')
    expect(dataRows).toEqual([
      ['СД-21', 20],
      ['АД-21', 13],
      ['ЛД-31', 18],
    ])
    expect(controlRows).toEqual([
      ['Итого:', 33],
      ['ВСЕГО:', 51],
    ])
  })

  it('пустое правило не фильтрует ничего', () => {
    const rows: Grid = [['x', 1]]
    expect(filterServiceRows(rows, '')).toEqual({ dataRows: rows, controlRows: [] })
  })

  it('сверяет данные с контрольными суммами и показывает расхождение', () => {
    const rows: Grid = [
      ['СД-21', 20],
      ['АД-21', 13],
      ['Итого:', 999],
    ]
    const { dataRows, controlRows } = filterServiceRows(rows, 'итого')
    const [reconciliation] = reconcileTotals(dataRows, controlRows, [1])
    expect(reconciliation).toEqual({ columnIndex: 1, dataSum: 33, controlSum: 999, matches: false })
  })

  it('совпадающие суммы matches=true', () => {
    const rows: Grid = [
      ['СД-21', 20],
      ['АД-21', 13],
      ['Итого:', 33],
    ]
    const { dataRows, controlRows } = filterServiceRows(rows, 'итого')
    const [reconciliation] = reconcileTotals(dataRows, controlRows, [1])
    expect(reconciliation!.matches).toBe(true)
  })
})

describe('расхождения в численности одной группы (§3.8c)', () => {
  it('находит группу «КЛД-21» с тремя разными значениями численности, как в образце', () => {
    const rows: Grid = [
      ['КЛД-21', 17],
      ['КЛД-21', 17],
      ['КЛД-21', 30],
      ['КСД-31', 19],
      ['КСД-31', 23],
      ['ЛД-41', 25],
      ['ЛД-41', 25],
    ]
    const discrepancies = collectDiscrepancies(rows, [0], 1)
    expect(discrepancies).toHaveLength(2)
    const kld = discrepancies.find((d) => d.key === 'КЛД-21')!
    expect(kld.values).toEqual([
      { value: '17', count: 2 },
      { value: '30', count: 1 },
    ])
    // ЛД-41 численность совпадает везде — расхождением не считается.
    expect(discrepancies.find((d) => d.key === 'ЛД-41')).toBeUndefined()
  })

  it('без разрешения расхождений импорт не должен применяться — resolveDiscrepancies переписывает выбранное значение', () => {
    const rows: Grid = [
      ['КЛД-21', 17],
      ['КЛД-21', 30],
    ]
    const resolved = resolveDiscrepancies(rows, [0], 1, { 'КЛД-21': '30' })
    expect(resolved.every((r) => r[1] === '30')).toBe(true)
  })
})

describe('целевые схемы импорта (§3.8e)', () => {
  it('знает обязательные и необязательные поля для всех четырёх сущностей', () => {
    expect(Object.keys(TARGET_SCHEMAS).sort()).toEqual(['calendar_period', 'curriculum', 'teacher', 'teaching_load'].sort())
    for (const fields of Object.values(TARGET_SCHEMAS)) {
      expect(fields.some((f) => f.required)).toBe(true)
    }
  })

  it('сопоставляет колонки в объекты по выбранным полям, отбрасывая полностью пустые строки', () => {
    const rows: Grid = [
      ['Анатомия', 4, 120],
      ['', '', ''],
      ['Физиология', 3, 90],
    ]
    const mapped = mapToEntity(rows, [
      { columnIndex: 0, field: 'disciplineName' },
      { columnIndex: 1, field: 'credits' },
      { columnIndex: 2, field: 'hoursTotal' },
    ])
    expect(mapped).toEqual([
      { disciplineName: 'Анатомия', credits: 4, hoursTotal: 120 },
      { disciplineName: 'Физиология', credits: 3, hoursTotal: 90 },
    ])
  })
})

describe('русский формат числа в ячейке', () => {
  // Excel в русской локали пишет часы как «1 234,5», причём разделителем разрядов бывает
  // обычный пробел, неразрывный (U+00A0) или узкий неразрывный (U+202F). Раньше Number()
  // на таких строках давал NaN, и часы молча пропадали из импорта как «пустая ячейка».
  it('разбирает разделитель разрядов и запятую как дробную часть', () => {
    const rows: Grid = [
      ['a', '1 234,5'],
      ['b', '1 234,5'],
      ['c', '1 234,5'],
      ['d', '72'],
      ['e', '36,5'],
    ]
    const sums = reconcileTotals(rows, [['итого', '2611']], [1])
    expect(sums[0]!.dataSum).toBe(1234.5 * 3 + 72 + 36.5)
  })

  it('нечисловая ячейка по-прежнему не считается нулём молча — она просто не суммируется', () => {
    const sums = reconcileTotals([['a', 'нет данных']], [['итого', '0']], [1])
    expect(sums[0]!.dataSum).toBe(0)
  })
})

describe('строки-заголовки блоков (§3.8a)', () => {
  // Структура годовой нагрузки: «№ цикла | дисциплина» → «преподаватель» → строки групп,
  // причём дисциплина лежит в той же колонке, что у строк данных группа.
  const rows: Grid = [
    ['1', '1', 'Хирургия', 390],
    ['Янхаева З.', 'Янхаева З.', 'Янхаева З.', 150],
    [null, 1, 'СД-21', 24],
    [null, 2, 'СД-31', 12],
    ['Кучерова В.', 'Кучерова В.', 'Кучерова В.', 186],
    [null, 1, 'ЛД-31', 36],
    ['2', '2', 'Терапия', 483],
    [null, 1, 'АД-21', 18],
  ]
  const rules = [
    { columnIndex: 0, pattern: '^\\d+$', field: 'disciplineName', sourceColumnIndex: 2 },
    { columnIndex: 0, pattern: '', field: 'teacherName', sourceColumnIndex: 0 },
  ]

  it('убирает строки-заголовки из данных и раздаёт их значения строкам блока', () => {
    const { dataRows, contexts, headerRows } = applyBlockHeaders(rows, rules)
    expect(headerRows).toHaveLength(4)
    expect(dataRows.map((r) => r[2])).toEqual(['СД-21', 'СД-31', 'ЛД-31', 'АД-21'])
    expect(contexts).toEqual([
      { disciplineName: 'Хирургия', teacherName: 'Янхаева З.' },
      { disciplineName: 'Хирургия', teacherName: 'Янхаева З.' },
      { disciplineName: 'Хирургия', teacherName: 'Кучерова В.' },
      // Новый цикл сбрасывает преподавателя прошлого: молча чужой преподаватель хуже пустого.
      { disciplineName: 'Терапия' },
    ])
  })

  it('правила с одинаковым условием срабатывают вместе', () => {
    const { contexts } = applyBlockHeaders(rows, [
      { columnIndex: 0, pattern: '^\\d+$', field: 'disciplineName', sourceColumnIndex: 2 },
      { columnIndex: 0, pattern: '^\\d+$', field: 'note', sourceColumnIndex: 3 },
    ])
    expect(contexts[0]).toEqual({ disciplineName: 'Хирургия', note: 390 })
  })

  it('без правил ничего не меняет', () => {
    const { dataRows, headerRows } = applyBlockHeaders(rows, [])
    expect(dataRows).toEqual(rows)
    expect(headerRows).toEqual([])
  })
})

describe('«широкая» таблица: несколько колонок одного поля дают отдельные записи', () => {
  const columns = [
    { columnIndex: 1, field: 'groupName' },
    { columnIndex: 2, field: 'hoursPlanned', constants: { lessonKind: 'Лек.', halfYear: 'I' } },
    { columnIndex: 3, field: 'hoursPlanned', constants: { lessonKind: 'Практ.', halfYear: 'I' } },
    { columnIndex: 4, field: 'hoursPlanned', constants: { lessonKind: 'Лек.', halfYear: 'II' } },
  ]

  it('разворачивает колонки-значения и пропускает пустые и нулевые ячейки', () => {
    const rows: Grid = [
      [null, 'СД-31', 12, 33, 12],
      [null, 'ЛД-41', 18, null, 0],
    ]
    const records = mapToEntity(rows, columns, [{ teacherName: 'Янхаева З.' }, { teacherName: 'Янхаева З.' }])
    expect(records).toEqual([
      { teacherName: 'Янхаева З.', groupName: 'СД-31', hoursPlanned: 12, lessonKind: 'Лек.', halfYear: 'I' },
      { teacherName: 'Янхаева З.', groupName: 'СД-31', hoursPlanned: 33, lessonKind: 'Практ.', halfYear: 'I' },
      { teacherName: 'Янхаева З.', groupName: 'СД-31', hoursPlanned: 12, lessonKind: 'Лек.', halfYear: 'II' },
      { teacherName: 'Янхаева З.', groupName: 'ЛД-41', hoursPlanned: 18, lessonKind: 'Лек.', halfYear: 'I' },
    ])
  })

  it('непустая ячейка строки важнее контекста блока', () => {
    const records = mapToEntity([['Петров С.', 'СД-21']], [{ columnIndex: 0, field: 'teacherName' }, { columnIndex: 1, field: 'groupName' }], [
      { teacherName: 'Янхаева З.' },
    ])
    expect(records).toEqual([{ teacherName: 'Петров С.', groupName: 'СД-21' }])
  })

  it('поле считается заданным, только если признак есть у каждой колонки-значения', () => {
    const covered = coveredFields(columns, [{ columnIndex: 0, pattern: '', field: 'teacherName', sourceColumnIndex: 0 }])
    expect([...covered].sort()).toEqual(['groupName', 'halfYear', 'hoursPlanned', 'lessonKind', 'teacherName'])
    const partial = coveredFields([...columns, { columnIndex: 5, field: 'hoursPlanned', constants: { halfYear: 'II' } }], [])
    expect(partial.has('lessonKind')).toBe(false)
    expect(partial.has('halfYear')).toBe(true)
  })

  it('подсказывает вид занятия и полугодие по многоуровневой шапке', () => {
    expect(guessColumnConstants('Нагрузка / Лек. / I полугодие')).toEqual({ lessonKind: 'Лек.', halfYear: 'I' })
    expect(guessColumnConstants('Нагрузка / Практ., семин., лаб. / II полугодие')).toEqual({ lessonKind: 'Практ.', halfYear: 'II' })
    expect(guessColumnConstants('Кол-во часов II полугодие / Итого')).toEqual({ halfYear: 'II' })
    expect(guessColumnConstants('Группа')).toEqual({})
  })

  it('разбирает полугодие', () => {
    expect(parseHalfYear('I')).toBe(1)
    expect(parseHalfYear('II')).toBe(2)
    expect(parseHalfYear('2 полугодие')).toBe(2)
    expect(parseHalfYear(1)).toBe(1)
    expect(parseHalfYear('III')).toBeNull()
    expect(parseHalfYear('')).toBeNull()
  })
})

describe('ФИО из файла против справочника', () => {
  it('узнаёт инициалы с точками и без финальной точки', () => {
    expect(matchesPersonName('Абдуллаева М.Н', 'Абдуллаева', 'Мира')).toBe(true)
    expect(matchesPersonName('Исмаилова З.Д.', 'Исмаилова', 'Зарина')).toBe(true)
    expect(matchesPersonName('Кубатова А. ', 'Кубатова', 'Айгуль')).toBe(true)
    expect(matchesPersonName('Кубатова Б.', 'Кубатова', 'Айгуль')).toBe(false)
  })

  it('узнаёт сокращённую частицу «кызы»/«уулу» в фамилии из нескольких слов', () => {
    expect(matchesPersonName('Омуркул к. К.', 'Омуркул кызы', 'Каныкей')).toBe(true)
    expect(matchesPersonName('Омуркул кызы Каныкей', 'Омуркул кызы', 'Каныкей')).toBe(true)
    expect(matchesPersonName('Омуркул к. К.', 'Омуркул кызы', 'Бермет')).toBe(false)
  })

  it('не принимает инициал «К.» за частицу у фамилии из одного слова', () => {
    expect(matchesPersonName('Иванова К. Т.', 'Иванова', 'Ксения')).toBe(true)
  })
})
