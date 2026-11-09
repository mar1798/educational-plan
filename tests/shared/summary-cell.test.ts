import { describe, expect, it } from 'vitest'
import { buildSummaryCell, teacherShortName, type SummaryCellEntry } from '../../src/shared/schedule/summary-cell'

const att = (groupId: number, subgroupNo: number | null) => ({
  groupId,
  groupName: 'Г',
  subgroupId: null,
  subgroupNo,
  posFrom: 1,
  posTo: 10,
})

function entry(id: number, name: string, teacher: string, side: SummaryCellEntry['subgroupSide'], clinical: boolean, no: number | null = null, groups = [1]): SummaryCellEntry {
  return {
    id,
    disciplineShortName: name,
    teacherName: teacher,
    subgroupSide: side,
    isClinicalSubgroup: clinical,
    attendees: groups.map((g) => att(g, no)),
  }
}

describe('buildSummaryCell', () => {
  it('занятие группы: дисциплина и преподаватель', () => {
    const [p] = buildSummaryCell([entry(1, 'ГиЭЧ', 'Иванов Иван', null, false)], 1)
    expect(p).toMatchObject({
      top: 'ГиЭЧ',
      bottom: 'Иванов И.',
      isStream: false,
    })
  })

  it('поток помечается', () => {
    const [p] = buildSummaryCell([entry(1, 'Ист. КР', 'Иванов Иван', null, false, null, [1, 2])], 1)
    expect(p!.isStream).toBe(true)
  })

  it('неклиническое деление: стороны через «/», преподаватели в том же порядке', () => {
    const cell = buildSummaryCell([entry(2, 'Ин. яз.', 'Петрова Анна', 'right', false, 2), entry(1, 'Кырг. яз.', 'Сидоров Олег', 'left', false, 1)], 1)
    expect(cell).toHaveLength(1)
    expect(cell[0]).toMatchObject({
      top: 'Кырг. яз. / Ин. яз.',
      bottom: 'Сидоров О./Петрова А.',
      entryIds: [1, 2],
    })
  })

  it('одна сторона пустая: «/» остаётся сверху, снизу просто преподаватель (шаблон 06.11)', () => {
    const left = buildSummaryCell([entry(1, 'Ист. КР', 'Иванов Иван', 'left', false, 1)], 1)[0]!
    expect([left.top, left.bottom]).toEqual(['Ист. КР /', 'Иванов И.'])
    const right = buildSummaryCell([entry(1, 'Неорг. хим.', 'Иванов Иван', 'right', false, 2)], 1)[0]!
    expect([right.top, right.bottom]).toEqual(['/ Неорг. хим.', 'Иванов И.'])
  })

  it('клиническое занятие — римский номер на своей стороне: I слева, II и III справа', () => {
    expect(buildSummaryCell([entry(1, 'ЗОЖ', 'Жумакеева Жамиля', 'left', true, 1)], 1)[0]!.top).toBe('I ЗОЖ /')
    expect(buildSummaryCell([entry(1, 'ЗОЖ', 'Жумакеева Жамиля', 'right', true, 2)], 1)[0]!.top).toBe('/ II ЗОЖ')
    expect(buildSummaryCell([entry(1, 'ОСД', 'Абдиева Жылдыз', 'third', true, 3)], 1)[0]!.top).toBe('/ III ОСД')
  })

  it('неклиническое и клиническое в одной паре — одна ячейка, как «Лат. яз. / II ЗОЖ»', () => {
    const cell = buildSummaryCell([entry(2, 'ЗОЖ', 'Жумакеева Жамиля', 'right', true, 2), entry(1, 'Лат. яз.', 'Мусаева Эльвира', 'left', false, 1)], 1)
    expect(cell).toHaveLength(1)
    expect(cell[0]).toMatchObject({ top: 'Лат. яз. / II ЗОЖ', bottom: 'Мусаева Э./Жумакеева Ж.' })
  })

  it('две клинические бригады в одной паре', () => {
    const cell = buildSummaryCell([entry(2, 'Терап.', 'Петрова Анна', 'right', true, 2), entry(1, 'Офт.', 'Сидоров Олег', 'left', true, 1)], 1)
    expect(cell.map((p) => p.top)).toEqual(['I Офт. / II Терап.'])
  })

  it('три подгруппы читаются как «I / II / III»', () => {
    const cell = buildSummaryCell([entry(1, 'А', 'Иванов Иван', 'left', false, 1), entry(2, 'Б', 'Иванов Иван', 'right', false, 2), entry(3, 'В', 'Иванов Иван', 'third', false, 3)], 1)
    expect(cell[0]!.top).toBe('А / Б / В')
  })
})

describe('teacherShortName', () => {
  it('сокращает имя до инициала', () => {
    expect(teacherShortName('Иванов Иван')).toBe('Иванов И.')
    expect(teacherShortName('Иванов')).toBe('Иванов')
  })
})
