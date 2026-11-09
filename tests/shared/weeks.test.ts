import { describe, expect, it } from 'vitest'
import { describeLoadWeeks, hoursInWeek, lectureFirstWeeks, LoadWeeksError, resolveLoadWeeks } from '../../src/shared/load/weeks'

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

describe('lectureFirstWeeks — сначала лекции, потом практика (решение 53)', () => {
  type L = { id: number; lessonKind: 'theory' | 'practice' | 'seminar' | 'lab'; hoursPlanned: number; curriculumRowId: number; groups: number[]; subgroupId?: number | null; weekFrom?: number | null; weekTo?: number | null; hoursPerWeek?: number | null }
  const run = (loads: L[]) => new Map(lectureFirstWeeks(loads, (l) => l.groups, ctx).map((l) => [l.id, resolveLoadWeeks(l, ctx)]))

  it('без ручных недель: лекции с 1-й недели, практика сразу после них; 18 недель делятся по часам', () => {
    const r = run([
      { id: 1, lessonKind: 'theory', hoursPlanned: 36, curriculumRowId: 7, groups: [1] },
      { id: 2, lessonKind: 'practice', hoursPlanned: 72, curriculumRowId: 7, groups: [1] },
    ])
    expect(r.get(1)).toMatchObject({ weekFrom: 1, weekTo: 6, hoursPerWeek: 6 })
    expect(r.get(2)).toMatchObject({ weekFrom: 7, weekTo: 18, hoursPerWeek: 6 })
  })

  it('короткие лекции не сдвигают практику раньше недели практики семестра', () => {
    const r = run([
      { id: 1, lessonKind: 'theory', hoursPlanned: 6, curriculumRowId: 7, groups: [1] },
      { id: 2, lessonKind: 'practice', hoursPlanned: 90, curriculumRowId: 7, groups: [1] },
    ])
    expect(r.get(1)).toMatchObject({ weekFrom: 1, weekTo: 3 })
    expect(r.get(2)!.weekFrom).toBe(4)
  })

  it('поточная лекция и практика каждой группы: практика всех групп начинается после конца потока', () => {
    const r = run([
      { id: 1, lessonKind: 'theory', hoursPlanned: 36, curriculumRowId: 7, groups: [1, 2] },
      { id: 2, lessonKind: 'practice', hoursPlanned: 72, curriculumRowId: 7, groups: [1], subgroupId: 11 },
      { id: 3, lessonKind: 'practice', hoursPlanned: 72, curriculumRowId: 7, groups: [1], subgroupId: 12 },
      { id: 4, lessonKind: 'practice', hoursPlanned: 72, curriculumRowId: 7, groups: [2] },
    ])
    expect(r.get(1)!.weekTo).toBe(6) // подгруппы параллельны: 36 / (36 + 72)
    expect([r.get(2)!.weekFrom, r.get(3)!.weekFrom, r.get(4)!.weekFrom]).toEqual([7, 7, 7])
  })

  it('заданное руками не трогается: явная практика задаёт конец лекций, явные лекции — начало практики', () => {
    const byPractice = run([
      { id: 1, lessonKind: 'theory', hoursPlanned: 36, curriculumRowId: 7, groups: [1] },
      { id: 2, lessonKind: 'practice', hoursPlanned: 30, curriculumRowId: 7, groups: [1], weekFrom: 9 },
    ])
    expect(byPractice.get(1)).toMatchObject({ weekFrom: 1, weekTo: 8 })
    expect(byPractice.get(2)!.weekFrom).toBe(9)

    const byTheory = run([
      { id: 1, lessonKind: 'theory', hoursPlanned: 36, curriculumRowId: 7, groups: [1], hoursPerWeek: 6 },
      { id: 2, lessonKind: 'practice', hoursPlanned: 30, curriculumRowId: 7, groups: [1] },
    ])
    expect(byTheory.get(1)).toMatchObject({ weekFrom: 1, weekTo: 6, manual: true })
    expect(byTheory.get(2)!.weekFrom).toBe(7)
  })

  it('практика с ручной недели раньше недели практики семестра: лекции не сжимаются в 1–2 недели', () => {
    const r = run([
      { id: 1, lessonKind: 'theory', hoursPlanned: 36, curriculumRowId: 7, groups: [1] },
      { id: 2, lessonKind: 'practice', hoursPlanned: 36, curriculumRowId: 7, groups: [1], weekFrom: 2 },
    ])
    expect(r.get(1)).toMatchObject({ weekFrom: 1, weekTo: 18 })
  })

  it('у практики задана только интенсивность: начало всё равно после лекций, лекции по пропорции', () => {
    const r = run([
      { id: 1, lessonKind: 'theory', hoursPlanned: 36, curriculumRowId: 7, groups: [1] },
      { id: 2, lessonKind: 'practice', hoursPlanned: 36, curriculumRowId: 7, groups: [1], hoursPerWeek: 4 },
    ])
    expect(r.get(1)).toMatchObject({ weekFrom: 1, weekTo: 9 })
    expect(r.get(2)).toMatchObject({ weekFrom: 10, weekTo: 18, hoursPerWeek: 4 })
  })

  it('поток с разной практикой у групп: берётся самый ранний конец лекции, ручная практика не перекрывается', () => {
    const uneven = run([
      { id: 1, lessonKind: 'theory', hoursPlanned: 36, curriculumRowId: 7, groups: [1, 2] },
      { id: 2, lessonKind: 'practice', hoursPlanned: 72, curriculumRowId: 7, groups: [1] },
      { id: 3, lessonKind: 'practice', hoursPlanned: 18, curriculumRowId: 7, groups: [2] },
    ])
    expect(uneven.get(1)!.weekTo).toBe(6)
    expect([uneven.get(2)!.weekFrom, uneven.get(3)!.weekFrom]).toEqual([7, 7])

    const manual = run([
      { id: 1, lessonKind: 'theory', hoursPlanned: 36, curriculumRowId: 7, groups: [1, 2] },
      { id: 2, lessonKind: 'practice', hoursPlanned: 36, curriculumRowId: 7, groups: [1], weekFrom: 5 },
      { id: 3, lessonKind: 'practice', hoursPlanned: 36, curriculumRowId: 7, groups: [2] },
    ])
    expect(manual.get(1)!.weekTo).toBe(4)
    expect(manual.get(3)!.weekFrom).toBe(5)
  })

  it('практика целой группы и подгрупп: к часам целой прибавляется самая длинная подгруппа', () => {
    const r = run([
      { id: 1, lessonKind: 'theory', hoursPlanned: 36, curriculumRowId: 7, groups: [1] },
      { id: 2, lessonKind: 'practice', hoursPlanned: 8, curriculumRowId: 7, groups: [1] },
      { id: 3, lessonKind: 'practice', hoursPlanned: 100, curriculumRowId: 7, groups: [1], subgroupId: 11 },
    ])
    expect(r.get(1)!.weekTo).toBe(5) // 18 × 36 / 144 = 4,5 → 5, а не 15
  })

  it('неделя практики за пределами семестра — ничего не переставляем', () => {
    const loads: L[] = [
      { id: 1, lessonKind: 'theory', hoursPlanned: 36, curriculumRowId: 7, groups: [1] },
      { id: 2, lessonKind: 'practice', hoursPlanned: 30, curriculumRowId: 7, groups: [1] },
    ]
    expect(lectureFirstWeeks(loads, (l) => l.groups, { weeksCount: 18, practiceStartWeek: 20 })).toEqual(loads)
  })

  it('без практики, семинары и лабораторные — как раньше, на весь семестр', () => {
    const r = run([
      { id: 1, lessonKind: 'theory', hoursPlanned: 36, curriculumRowId: 7, groups: [1] },
      { id: 2, lessonKind: 'seminar', hoursPlanned: 18, curriculumRowId: 7, groups: [1] },
      { id: 3, lessonKind: 'practice', hoursPlanned: 30, curriculumRowId: 8, groups: [1] },
    ])
    expect(r.get(1)).toMatchObject({ weekFrom: 1, weekTo: 18 })
    expect(r.get(2)).toMatchObject({ weekFrom: 1, weekTo: 18 })
    expect(r.get(3)).toMatchObject({ weekFrom: 4, weekTo: 18 })
  })
})
