import { describe, expect, it } from 'vitest'
import { solve } from '../../src/solver'
import { solveGreedy } from '../../src/solver/greedy'
import { Solution } from '../../src/solver/occupancy'
import { computePenalty } from '../../src/solver/penalty'
import { validateSolution } from '../../src/solver/validate'
import { fixedAt, makeGroup, makeRoom, makeSlots, makeTeacher, makeUnit, roomyInput, tightInput } from '../fixtures/solver'
import type { SolverInput, SolverOutput } from '../../src/solver/model'
import { DEFAULT_WEIGHTS, slotIndex } from '../../src/solver/model'

/** Настоящий взвешенный штраф решения (§5.5) — в отличие от `output.penalty` жадной фазы,
 * которая до локального поиска использует грубую заглушку `unplaced.length * 1000` (§6 этап 5). */
function realPenalty(input: SolverInput, output: SolverOutput): number {
  const unitsById = new Map(input.units.map((u) => [u.id, u]))
  const state = Solution.forInput(input)
  for (const f of input.fixed) state.occupy(f, f.slot, f.roomIdx, input.slots[f.slot]!.academicHours)
  const placed = []
  for (const a of output.assignments) {
    const unit = unitsById.get(a.unitId)!
    state.occupy(unit, a.slot, a.roomIdx, input.slots[a.slot]!.academicHours)
    placed.push({ unit, slot: a.slot, roomIdx: a.roomIdx })
  }
  return computePenalty(input, state, placed, output.unplaced.length).total
}

function withFastBudget(input: SolverInput, timeBudgetMs = 400): SolverInput {
  return { ...input, limits: { ...input.limits, timeBudgetMs, maxIterations: 8000 } }
}

describe('localSearch (solve = жадная фаза + локальный поиск)', () => {
  it('никогда не нарушает жёсткие ограничения на решении с ходами по всем видам', () => {
    const input = withFastBudget(tightInput())
    return solve(input).then((output) => {
      expect(validateSolution(input, output)).toEqual([])
      expect(output.assignments.length + output.unplaced.length).toBe(input.units.length)
    })
  })

  it('воспроизводимость: тот же вход и seed дают идентичный результат', async () => {
    const input = withFastBudget(tightInput())
    const a = await solve({ ...input, limits: { ...input.limits, seed: 42 } })
    const b = await solve({ ...input, limits: { ...input.limits, seed: 42 } })
    expect(a.assignments).toEqual(b.assignments)
    expect(a.unplaced.map((u) => u.unitId).sort()).toEqual(b.unplaced.map((u) => u.unitId).sort())
    expect(a.penalty).toBe(b.penalty)
  })

  it('не ухудшает штраф жадной фазы (локальный поиск только улучшает или сохраняет)', async () => {
    const input = withFastBudget(tightInput())
    const greedyOnly = solveGreedy(input)
    const searched = await solve(input)
    expect(searched.penalty).toBeLessThanOrEqual(realPenalty(input, greedyOnly))
  })

  it('закреплённые (is_locked) юниты не двигаются: остаются в fixed, не в units', async () => {
    const room = makeRoom(0)
    const teacher = makeTeacher(0)
    const group = makeGroup(0)
    const lockedUnit = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] })
    const fixed = fixedAt(lockedUnit, slotIndex(1, 1), 0)
    const movable = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] })

    const input: SolverInput = {
      units: [movable],
      teachers: [teacher],
      rooms: [room],
      buildings: [{ idx: 0, id: 1, clinicalMode: null }],
      groups: [group],
      slots: makeSlots(),
      fixed: [fixed],
      weights: DEFAULT_WEIGHTS,
      limits: { timeBudgetMs: 300, maxIterations: 3000, seed: 7 },
    }

    const output = await solve(input)
    expect(output.assignments.every((a) => a.unitId !== fixed.id)).toBe(true)
    expect(validateSolution(input, output)).toEqual([])
  })

  it('roomy: остаётся 100% размещения после локального поиска', async () => {
    const input = withFastBudget(roomyInput(4, 4))
    const output = await solve(input)
    expect(output.unplaced).toHaveLength(0)
    expect(output.assignments).toHaveLength(input.units.length)
    expect(validateSolution(input, output)).toEqual([])
  })

  it('breakdown содержит все десять кодов мягких критериев плюс unplaced', async () => {
    const input = withFastBudget(tightInput())
    const output = await solve(input)
    const codes = [
      'student_gaps',
      'teacher_gaps',
      'spread',
      'difficulty_early',
      'clinical_grouping',
      'teacher_preference',
      'late_pair',
      'clinical_block_start',
      'room_missing',
      'teacher_days',
      'unplaced',
    ]
    for (const code of codes) expect(output.breakdown).toHaveProperty(code)
  })

  it('cancel: isCancelled останавливает локальный поиск на середине и возвращает согласованное решение', async () => {
    const input = withFastBudget(tightInput(), 5000)
    let calls = 0
    // Пропускаем жадную фазу (она тоже спрашивает isCancelled) и обрываем уже во время поиска.
    const output = await solve(input, { isCancelled: () => ++calls > 50 })
    expect(output.stoppedBy).toBe('cancelled')
    expect(validateSolution(input, output)).toEqual([])
    expect(output.assignments.length + output.unplaced.length).toBe(input.units.length)
  })
})
