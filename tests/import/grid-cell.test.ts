import { describe, expect, it } from 'vitest'
import { parseCell, parseTeacherName } from '../../src/main/import/grid/cell'

describe('разбор ячейки сводного расписания (этап Ж)', () => {
  it('занятие группы: дисциплина и преподаватель', () => {
    expect(parseCell('ГиЭЧ', 'Иванов И.').sides).toEqual([{ discipline: 'ГиЭЧ', teacher: 'Иванов И.', subgroupNo: null, clinical: false }])
  })

  it('неклиническое деление: стороны через «/», преподаватели в том же порядке', () => {
    const { sides, teacherMismatch } = parseCell('Кырг. яз. / Ин. яз.', 'Сидоров О. / Петрова А.')
    expect(sides).toEqual([
      { discipline: 'Кырг. яз.', teacher: 'Сидоров О.', subgroupNo: 1, clinical: false },
      { discipline: 'Ин. яз.', teacher: 'Петрова А.', subgroupNo: 2, clinical: false },
    ])
    expect(teacherMismatch).toBe(false)
  })

  it('римские номера с «/»: берутся явные номера, не позиции', () => {
    const { sides } = parseCell('I ФГ / II ИОПД', 'Иванов И. / Петров П.')
    expect(sides.map((s) => [s.discipline, s.subgroupNo, s.clinical])).toEqual([['ФГ', 1, false], ['ИОПД', 2, false]])
  })

  it('одна сторона пустая: занятие только у одной подгруппы', () => {
    expect(parseCell('Ист. КР /', 'Иванов И. /').sides).toEqual([{ discipline: 'Ист. КР', teacher: 'Иванов И.', subgroupNo: 1, clinical: false }])
    expect(parseCell('/ II Неорг. хим.', '/ Петров П.').sides).toEqual([{ discipline: 'Неорг. хим.', teacher: 'Петров П.', subgroupNo: 2, clinical: false }])
  })

  it('клиническое занятие — номер без «/»', () => {
    expect(parseCell('I Офт.', 'Иванов И.').sides).toEqual([{ discipline: 'Офт.', teacher: 'Иванов И.', subgroupNo: 1, clinical: true }])
    expect(parseCell('III Педиатр.', 'Иванов И.').sides[0]).toMatchObject({ subgroupNo: 3, clinical: true })
  })

  it('несколько занятий через «;» (так пишет выгрузка)', () => {
    const { sides } = parseCell('I Офт.; II Терап.', 'Иванов И.; Петров П.')
    expect(sides.map((s) => [s.discipline, s.teacher, s.subgroupNo, s.clinical])).toEqual([['Офт.', 'Иванов И.', 1, true], ['Терап.', 'Петров П.', 2, true]])
  })

  it('«II» внутри слова — не номер подгруппы', () => {
    expect(parseCell('IIFF', null).sides[0]).toMatchObject({ discipline: 'IIFF', subgroupNo: null })
  })

  it('число сторон в нижней строке не совпало — предупреждение, преподаватель не угадывается', () => {
    const r = parseCell('А / Б', 'Иванов И.')
    expect(r.teacherMismatch).toBe(true)
    expect(r.sides.every((s) => s.teacher === null)).toBe(true)
  })

  it('пустая ячейка — нет занятий', () => {
    expect(parseCell(null, null).sides).toEqual([])
    expect(parseCell('  ', 'Иванов И.').sides).toEqual([])
  })

  it('имя преподавателя: фамилия и инициал', () => {
    expect(parseTeacherName('Иванов И.')).toEqual({ lastName: 'Иванов', initial: 'и' })
    expect(parseTeacherName('Иванов И.П.')).toEqual({ lastName: 'Иванов', initial: 'и' })
    expect(parseTeacherName('Иванов')).toEqual({ lastName: 'Иванов', initial: null })
  })
})
