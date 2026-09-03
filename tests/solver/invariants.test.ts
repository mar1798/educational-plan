/**
 * Регрессии §9.1: инварианты, которые «зелёные» тесты этапов 5-6 не проверяли —
 * обратимость состояния занятости, монотонность фазы 2 относительно фазы 1 и
 * воспроизводимость по seed.
 */
import { describe, expect, it } from 'vitest'
import { Solution } from '../../src/solver/occupancy'
import { canPlace } from '../../src/solver/hard'
import { solve } from '../../src/solver'
import { solveGreedy } from '../../src/solver/greedy'
import { validateSolution } from '../../src/solver/validate'
import { DEFAULT_WEIGHTS, slotIndex } from '../../src/solver/model'
import type { SolverInput } from '../../src/solver/model'
import { makeBuilding, makeGroup, makeRoom, makeSlots, makeTeacher, makeUnit, baseLimits, roomyInput, tightInput, minimalInput, subgroupsInput, limitsInput } from '../fixtures/solver'

/** Вход: 2 здания, группа 0, клиническая база = здание 1. */
function clinicalInput(): SolverInput {
  const groups = [makeGroup(0)]
  const teachers = [makeTeacher(0), makeTeacher(1)]
  const rooms = [makeRoom(0, { buildingIdx: 0 }), makeRoom(1, { buildingIdx: 1 })]
  const buildings = [makeBuilding(0), makeBuilding(1, { clinicalMode: 'full_day' })]
  const full = makeUnit({ id: 9001, teacherIdx: 0, clinicalMode: 'full_day', buildingIdxRequired: 1, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] })
  const other = makeUnit({ id: 9002, teacherIdx: 1, buildingIdxRequired: 1, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] })
  return { units: [full, other], teachers, rooms, buildings, groups, slots: makeSlots(), fixed: [], weights: DEFAULT_WEIGHTS, limits: baseLimits() }
}

describe('состояние размещения: vacate отменяет occupy', () => {
  it('vacate возвращает состояние ровно к тому, что было до occupy (клиническая база)', () => {
    const input = clinicalInput()
    const [full, other] = input.units
    const s = Solution.forInput(input)
    const slotA = slotIndex(1, 1)
    const slotB = slotIndex(1, 2)

    s.occupy(other!, slotB, 1, 2)
    const before = s.clinicalDay.slice()

    s.occupy(full!, slotA, 1, 2)
    s.vacate(full!, slotA, 1, 2)

    expect(Array.from(s.clinicalDay)).toEqual(Array.from(before))
  })

  it('после снятия full_day-занятия день снова открыт для другого здания', () => {
    const input = clinicalInput()
    const [full, other] = input.units
    const s = Solution.forInput(input)
    s.occupy(other!, slotIndex(1, 2), 1, 2)
    s.occupy(full!, slotIndex(1, 1), 1, 2)
    s.vacate(full!, slotIndex(1, 1), 1, 2)

    // Занятие в здании 0 в тот же день: full_day-занятия больше нет, запрета быть не должно.
    const probe = makeUnit({ id: 9003, teacherIdx: 1, buildingIdxRequired: 0, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] })
    expect(canPlace(input, s, probe, slotIndex(1, 3), 0)).toBeNull()
  })
})

describe('локальный поиск не ухудшает результат жадной фазы', () => {
  const cases: [string, () => SolverInput][] = [
    ['minimal', minimalInput],
    ['subgroups', subgroupsInput],
    ['limits', limitsInput],
    ['roomy', () => roomyInput(6, 5)],
    ['tight', () => tightInput(6)],
  ]
  for (const [name, make] of cases) {
    for (const seed of [1, 7, 42]) {
      it(`${name} seed=${seed}`, async () => {
        const g = make()
        g.limits = { ...g.limits, timeBudgetMs: 700, seed }
        const greedy = solveGreedy(g)
        const s = make()
        s.limits = { ...s.limits, timeBudgetMs: 700, seed }
        const full = await solve(s)
        expect(validateSolution(s, full)).toEqual([])
        expect(full.penalty).toBeLessThanOrEqual(greedy.penalty)
      })
    }
  }
})

describe('воспроизводимость по seed (§5.6)', () => {
  it('два прогона с одним seed дают одинаковый результат', async () => {
    const input = tightInput(5)
    input.limits = { ...input.limits, timeBudgetMs: 600, seed: 123 }
    const a = await solve(input)
    const b = await solve(input)
    expect(a.assignments).toEqual(b.assignments)
    expect(a.penalty).toBe(b.penalty)
  })
})
