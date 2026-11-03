import { describe, expect, it } from 'vitest'
import { describeLoadWeeks, hoursInWeek, LoadWeeksError, resolveLoadWeeks } from '../../src/shared/load/weeks'

const ctx = { weeksCount: 18, practiceStartWeek: null }
const theory = { lessonKind: 'theory' as const, hoursPlanned: 36 }

describe('resolveLoadWeeks (этап В)', () => {
  it('ничего не задано: равномерно на весь семестр; у практики начало — неделя практики', () => {
    expect(resolveLoadWeeks(theory, ctx)).toMatchObject({ weekFrom: 1, weekTo: 18, hoursPerWeek: 2, manual: false })
    expect(resolveLoadWeeks({ lessonKind: 'practice', hoursPlanned: 30 }, ctx)).toMatchObject({ weekFrom: 4, weekTo: 18, weeksCount: 15, hoursPerWeek: 2 })
    expect(resolveLoadWeeks({ lessonKind: 'practice', hoursPlanned: 30 }, { weeksCount: 18, practiceStartWeek: 6 }).weekFrom).toBe(6)
  })

  it('семинары и лабораторные идут с 1-й недели', () => {
    expect(resolveLoadWeeks({ lessonKind: 'seminar', hoursPlanned: 18 }, ctx).weekFrom).toBe(1)
    expect(resolveLoadWeeks({ lessonKind: 'lab', hoursPlanned: 18 }, ctx).weekFrom).toBe(1)
  })

  it('задан ч/нед без «по неделю»: последняя неделя считается', () => {
    const r = resolveLoadWeeks({ ...theory, hoursPlanned: 36, hoursPerWeek: 8 }, ctx)
    expect(r).toMatchObject({ weekFrom: 1, weekTo: 5, manual: true })
    expect(describeLoadWeeks({ ...theory, hoursPerWeek: 8 }, r)).toBe('нед. 1–5, 8 ч/нед, итого 40 ч из 36 — последняя неделя неполная')
  })

  it('последняя неделя неполная: часы по неделям', () => {
    const load = { ...theory, hoursPerWeek: 8 }
    const r = resolveLoadWeeks(load, ctx)
    expect([1, 4, 5, 6].map((w) => hoursInWeek(load, r, w))).toEqual([8, 8, 4, 0])
  })

  it('заданы все три и не сходятся с планом: предупреждение с цифрами', () => {
    const r = resolveLoadWeeks({ ...theory, weekFrom: 1, weekTo: 4, hoursPerWeek: 8 }, ctx)
    expect(r.warnings).toEqual(['8 ч/нед × 4 нед. = 32 ч, а по плану 36 ч'])
  })

  it('ошибки: за пределами семестра, начало позже конца', () => {
    expect(() => resolveLoadWeeks({ ...theory, weekTo: 19 }, ctx)).toThrow(LoadWeeksError)
    expect(() => resolveLoadWeeks({ ...theory, hoursPerWeek: 1 }, ctx)).toThrow(/выходит за пределы/)
    expect(() => resolveLoadWeeks({ ...theory, weekFrom: 10, weekTo: 5 }, ctx)).toThrow(/позже/)
  })
})
