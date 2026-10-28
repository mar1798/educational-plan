import { describe, expect, it } from 'vitest'
import { solve } from '../../src/solver'
import { canPlace } from '../../src/solver/hard'
import type { SolverInput, SolverOutput, Unit } from '../../src/solver/model'
import { DEFAULT_WEIGHTS, slotIndex } from '../../src/solver/model'
import { Solution } from '../../src/solver/occupancy'
import { computeRawBreakdown } from '../../src/solver/penalty'
import { validateSolution } from '../../src/solver/validate'
import { baseLimits, makeBuilding, makeGroup, makeRoom, makeSlots, makeTeacher, makeUnit } from '../fixtures/solver'

const whole = [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] as const }]

function input(units: Unit[], overrides: Partial<SolverInput> = {}): SolverInput {
  return {
    units,
    teachers: [makeTeacher(0), makeTeacher(1), makeTeacher(2)],
    rooms: [makeRoom(0), makeRoom(1)],
    buildings: [makeBuilding(0)],
    groups: [makeGroup(0)],
    slots: makeSlots(),
    fixed: [],
    weights: DEFAULT_WEIGHTS,
    limits: baseLimits(),
    ...overrides,
  }
}

function snapshotOf(state: Solution): number[][] {
  return [state.teacherBusy, state.roomBusy, state.studentBusy, state.pairsPerDayG, state.pairsPerDayT, state.studentHoursG].map((a) => [...a])
}

describe('длинные занятия (п. 48): занятие из нескольких пар подряд', () => {
  it('не помещается в день, если хвост выходит за 6-ю пару', () => {
    const inp = input([])
    const unit = makeUnit({ teacherIdx: 0, attendees: whole, span: 3 })
    const state = Solution.forInput(inp)
    expect(canPlace(inp, state, unit, slotIndex(1, 5), 0)).toBe('slot_disabled')
    expect(canPlace(inp, state, unit, slotIndex(1, 4), 0)).toBeNull()
  })

  it('занятость в середине блока запрещает постановку, а проверка не оставляет следов в состоянии', () => {
    const inp = input([])
    const state = Solution.forInput(inp)
    state.occupy(makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [1, 0] }] }), slotIndex(1, 3), 1)
    const before = snapshotOf(state)

    const unit = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [2, 0] }], span: 3 })
    expect(canPlace(inp, state, unit, slotIndex(1, 1), 0)).toBe('teacher_busy')
    expect(snapshotOf(state)).toEqual(before)
  })

  it('лимит пар дня у группы считает все пары блока', () => {
    const inp = input([], { groups: [makeGroup(0, { maxPairsPerDay: 2 })] })
    const unit = makeUnit({ teacherIdx: 0, attendees: whole, span: 3 })
    expect(canPlace(inp, Solution.forInput(inp), unit, slotIndex(1, 1), 0)).toBe('group_day_limit')
  })

  it('occupy/vacate занимают и освобождают все пары', () => {
    const inp = input([])
    const state = Solution.forInput(inp)
    const empty = snapshotOf(state)
    const unit = makeUnit({ teacherIdx: 0, attendees: whole, span: 3 })
    state.occupy(unit, slotIndex(2, 4), 0)
    expect(state.pairsPerDayG[1]).toBe(3)
    expect(state.studentHoursG[0]).toBe(6)
    state.vacate(unit, slotIndex(2, 4), 0)
    expect(snapshotOf(state)).toEqual(empty)
  })

  it('solve ставит длинные занятия целиком и с начала полудня, без жёстких нарушений', async () => {
    const units = [
      makeUnit({ teacherIdx: 0, attendees: whole, span: 3 }),
      makeUnit({ teacherIdx: 0, attendees: whole, span: 3 }),
      makeUnit({ teacherIdx: 1, attendees: whole, span: 2 }),
      makeUnit({ teacherIdx: 1, attendees: whole, span: 2 }),
      makeUnit({ teacherIdx: 2, attendees: whole }),
      makeUnit({ teacherIdx: 2, attendees: whole }),
    ]
    const inp = input(units, { limits: { ...baseLimits(), timeBudgetMs: 400, maxIterations: 5000 } })
    const output = await solve(inp)

    expect(validateSolution(inp, output)).toEqual([])
    expect(output.unplaced).toEqual([])
    for (const a of output.assignments) {
      const unit = units.find((u) => u.id === a.unitId)!
      const pair = inp.slots[a.slot]!.pair
      if (unit.span === 3) expect([1, 4]).toContain(pair)
      if (unit.span === 2) expect([1, 3, 5]).toContain(pair)
    }
  })

  it('валидатор ловит пересечение в хвосте блока и блок, вылезающий за день', () => {
    const long = makeUnit({ teacherIdx: 0, attendees: whole, span: 3 })
    const single = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [0, 0] }], roomOptional: true })
    const inp = input([long, single])
    const output = (assignments: SolverOutput['assignments']): SolverOutput => ({
      assignments,
      unplaced: [],
      penalty: 0,
      breakdown: {},
      iterations: 0,
      elapsedMs: 0,
      stoppedBy: 'completed',
    })

    const tail = validateSolution(inp, output([{ unitId: long.id, slot: slotIndex(1, 1), roomIdx: 0 }, { unitId: single.id, slot: slotIndex(1, 3), roomIdx: null }]))
    expect(tail.map((v) => v.reason)).toContain('teacher_busy')

    const overflow = validateSolution(inp, output([{ unitId: long.id, slot: slotIndex(1, 5), roomIdx: 0 }, { unitId: single.id, slot: slotIndex(2, 1), roomIdx: null }]))
    expect(overflow.map((v) => v.reason)).toEqual(['slot_disabled'])
  })

  it('штраф: поздние пары считаются по каждой паре блока, неудобное начало — один раз', () => {
    const inp = input([])
    const unit = makeUnit({ teacherIdx: 0, attendees: whole, span: 3, difficulty: 0 })

    const aligned = Solution.forInput(inp)
    aligned.occupy(unit, slotIndex(1, 4), 0)
    const rawAligned = computeRawBreakdown(inp, aligned, [{ unit, slot: slotIndex(1, 4), roomIdx: 0 }])
    expect(rawAligned.latePair).toBe(2)
    expect(rawAligned.sessionStart).toBe(0)

    const shifted = Solution.forInput(inp)
    shifted.occupy(unit, slotIndex(1, 2), 0)
    const rawShifted = computeRawBreakdown(inp, shifted, [{ unit, slot: slotIndex(1, 2), roomIdx: 0 }])
    expect(rawShifted.latePair).toBe(0)
    expect(rawShifted.sessionStart).toBe(1)
  })
})
