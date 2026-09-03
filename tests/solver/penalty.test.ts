import { describe, expect, it } from 'vitest'
import { slotIndex } from '../../src/solver/model'
import { Solution } from '../../src/solver/occupancy'
import { computeRawBreakdown, computePenalty, UNPLACED_PENALTY, zeroBreakdown } from '../../src/solver/penalty'
import { makeBuilding, makeGroup, makeRoom, makeSlots, makeTeacher, makeUnit } from '../fixtures/solver'
import type { PlacedUnit } from '../../src/solver/penalty'
import type { SolverInput, Unit } from '../../src/solver/model'

function baseInput(overrides: Partial<SolverInput> = {}): SolverInput {
  return {
    units: [],
    teachers: [makeTeacher(0)],
    rooms: [makeRoom(0)],
    buildings: [makeBuilding(0)],
    groups: [makeGroup(0, { studentsCount: 25 })],
    slots: makeSlots(),
    fixed: [],
    weights: {
      studentGaps: 1,
      teacherGaps: 1,
      spread: 1,
      difficultyEarly: 1,
      clinicalGrouping: 1,
      teacherPreference: 1,
      latePair: 1,
      clinicalBlockStart: 1,
      roomMissing: 1,
      teacherDays: 1,
    },
    limits: { timeBudgetMs: 1000, maxIterations: 1000, seed: 1 },
    ...overrides,
  }
}

function place(input: SolverInput, state: Solution, unit: Unit, slot: number, roomIdx: number | null): PlacedUnit {
  state.occupy(unit, slot, roomIdx, input.slots[slot]!.academicHours)
  return { unit, slot, roomIdx }
}

describe('penalty.computeRawBreakdown', () => {
  it('zeroBreakdown: пустое решение — все критерии нулевые', () => {
    const input = baseInput()
    const state = Solution.forInput(input)
    expect(computeRawBreakdown(input, state, [])).toEqual(zeroBreakdown())
  })

  it('studentGaps: окно между двумя занятиями группы считается по каждой позиции студента', () => {
    const input = baseInput()
    const state = Solution.forInput(input)
    const a = makeUnit({ teacherIdx: 0, disciplineIdx: 1, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] })
    const b = makeUnit({ teacherIdx: 0, disciplineIdx: 2, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] })
    const placed = [place(input, state, a, slotIndex(1, 1), 0), place(input, state, b, slotIndex(1, 3), null)]
    const raw = computeRawBreakdown(input, state, placed)
    // 25 студентов группы, окно на паре 2 — по одной дырке на позицию.
    expect(raw.studentGaps).toBe(25)
  })

  it('teacherGaps: окно у преподавателя считается один раз, а не по позициям', () => {
    const input = baseInput({ groups: [makeGroup(0), makeGroup(1)] })
    const state = Solution.forInput(input)
    const a = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] })
    const b = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 1, memberMask: [0xffffffff, 0xffffffff] }] })
    const placed = [place(input, state, a, slotIndex(1, 1), 0), place(input, state, b, slotIndex(1, 3), null)]
    const raw = computeRawBreakdown(input, state, placed)
    expect(raw.teacherGaps).toBe(1)
  })

  it('spread: второе занятие той же дисциплины у группы в тот же день — лишнее', () => {
    const input = baseInput({ teachers: [makeTeacher(0), makeTeacher(1)] })
    const state = Solution.forInput(input)
    const a = makeUnit({ teacherIdx: 0, disciplineIdx: 5, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] })
    const b = makeUnit({ teacherIdx: 1, disciplineIdx: 5, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] })
    const placed = [place(input, state, a, slotIndex(1, 1), 0), place(input, state, b, slotIndex(1, 2), 0)]
    const raw = computeRawBreakdown(input, state, placed)
    expect(raw.spread).toBe(1)
  })

  it('difficultyEarly: штраф растёт после второй пары пропорционально сложности', () => {
    const input = baseInput()
    const state = Solution.forInput(input)
    const a = makeUnit({ teacherIdx: 0, difficulty: 2 })
    const placed = [place(input, state, a, slotIndex(1, 4), 0)]
    const raw = computeRawBreakdown(input, state, placed)
    expect(raw.difficultyEarly).toBe(2 * (4 - 2))
  })

  it('latePair: занятие на 5-й и 6-й паре штрафуется, на более ранней — нет', () => {
    const input = baseInput({ teachers: [makeTeacher(0), makeTeacher(1)] })
    const state = Solution.forInput(input)
    const early = makeUnit({ teacherIdx: 0 })
    const late = makeUnit({ teacherIdx: 1 })
    const placed = [place(input, state, early, slotIndex(1, 4), 0), place(input, state, late, slotIndex(2, 5), 0)]
    const raw = computeRawBreakdown(input, state, placed)
    expect(raw.latePair).toBe(1)
  })

  it('roomMissing: занятие без кабинета считается', () => {
    const input = baseInput()
    const state = Solution.forInput(input)
    const a = makeUnit({ teacherIdx: 0, roomOptional: true })
    const placed = [place(input, state, a, slotIndex(1, 1), null)]
    const raw = computeRawBreakdown(input, state, placed)
    expect(raw.roomMissing).toBe(1)
  })

  it('teacherPreference: попадание в мягкую недоступность штрафуется на вес записи', () => {
    const slot = slotIndex(1, 1)
    const input = baseInput({ teachers: [makeTeacher(0, { softUnavailable: [{ mask: [1 << slot, 0], weight: 7 }] })] })
    const state = Solution.forInput(input)
    const a = makeUnit({ teacherIdx: 0 })
    const placed = [place(input, state, a, slot, 0)]
    const raw = computeRawBreakdown(input, state, placed)
    expect(raw.teacherPreference).toBe(7)
  })

  it('teacherDays: рабочих дней больше минимально необходимого при лимите пар в день', () => {
    const input = baseInput({
      groups: [makeGroup(0), makeGroup(1), makeGroup(2)],
      teachers: [makeTeacher(0, { maxPairsPerDay: 2 })],
    })
    const state = Solution.forInput(input)
    const a = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] })
    const b = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 1, memberMask: [0xffffffff, 0xffffffff] }] })
    const c = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 2, memberMask: [0xffffffff, 0xffffffff] }] })
    // 3 пары преподавателя размазаны по 3 дням, а с лимитом 2 пары/день хватило бы 2 дней.
    const placed = [
      place(input, state, a, slotIndex(1, 1), 0),
      place(input, state, b, slotIndex(2, 1), 0),
      place(input, state, c, slotIndex(3, 1), 0),
    ]
    const raw = computeRawBreakdown(input, state, placed)
    expect(raw.teacherDays).toBe(1)
  })

  it('clinicalGrouping + clinicalBlockStart: лишний день на базе и поздний старт блока', () => {
    const input = baseInput({ buildings: [makeBuilding(0, { clinicalMode: 'full_day' })] })
    const state = Solution.forInput(input)
    const a = makeUnit({ teacherIdx: 0, clinicalMode: 'full_day', buildingIdxRequired: 0, roomOptional: true })
    const b = makeUnit({ teacherIdx: 0, clinicalMode: 'full_day', buildingIdxRequired: 0, roomOptional: true })
    // Один день хватило бы (group.maxPairsPerDay=6, суммарно 2 пары), но заняты два разных дня,
    // и второй блок стартует не с первой пары.
    const placed = [place(input, state, a, slotIndex(1, 1), null), place(input, state, b, slotIndex(2, 3), null)]
    const raw = computeRawBreakdown(input, state, placed)
    expect(raw.clinicalGrouping).toBe(1)
    expect(raw.clinicalBlockStart).toBe(2)
  })

  it('computePenalty: суммирует взвешенные критерии и штраф за unplaced', () => {
    const input = baseInput()
    const state = Solution.forInput(input)
    const a = makeUnit({ teacherIdx: 0, difficulty: 1 })
    const placed = [place(input, state, a, slotIndex(1, 4), 0)]
    const result = computePenalty(input, state, placed, 2)
    expect(result.raw.difficultyEarly).toBe(2)
    expect(result.total).toBe(2 * UNPLACED_PENALTY + 2 * input.weights.difficultyEarly)
  })
})
