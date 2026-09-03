import { describe, expect, it } from 'vitest'
import { solve } from '../../src/solver'
import { solveGreedy } from '../../src/solver/greedy'
import { validateSolution } from '../../src/solver/validate'
import { fixedAt, makeBuilding, makeGroup, makeRoom, makeSlots, makeTeacher, makeUnit, roomyInput, tightInput } from '../fixtures/solver'
import type { SolverInput } from '../../src/solver/model'
import { DEFAULT_WEIGHTS, slotIndex } from '../../src/solver/model'

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
    // Обе фазы отдают штраф в одних единицах (§5.5), поэтому сравниваются напрямую.
    expect(searched.penalty).toBeLessThanOrEqual(greedyOnly.penalty)
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

  it('парные подгруппы после локального поиска остаются в одном слоте', async () => {
    const groups = [makeGroup(0, { studentsCount: 30 })]
    const teachers = [makeTeacher(0), makeTeacher(1), makeTeacher(2)]
    const rooms = [makeRoom(0), makeRoom(1), makeRoom(2)]
    const first = makeUnit({ teacherIdx: 0, students: 15, attendees: [{ groupIdx: 0, memberMask: [0xffff, 0] }] })
    const second = makeUnit({ teacherIdx: 1, students: 15, attendees: [{ groupIdx: 0, memberMask: [0xffff0000, 0] }] })
    first.pairedUnitId = second.id
    second.pairedUnitId = first.id
    // Соседи по группе, чтобы поиску было что двигать и он реально гонял ходы вокруг пары.
    const others = Array.from({ length: 6 }, () =>
      makeUnit({ teacherIdx: 2, students: 30, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0] }] }),
    )

    const input: SolverInput = {
      units: [first, second, ...others],
      teachers,
      rooms,
      buildings: [makeBuilding(0)],
      groups,
      slots: makeSlots(),
      fixed: [],
      weights: DEFAULT_WEIGHTS,
      limits: { timeBudgetMs: 500, maxIterations: 50_000, seed: 3 },
    }

    const output = await solve(input)
    // `pair_split` проверяет независимый валидатор — здесь ещё и явно, чтобы падение читалось.
    const a = output.assignments.find((x) => x.unitId === first.id)
    const b = output.assignments.find((x) => x.unitId === second.id)
    expect(a?.slot).toBe(b?.slot)
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
