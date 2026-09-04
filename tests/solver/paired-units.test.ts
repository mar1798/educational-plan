import { describe, expect, it } from 'vitest'
import { solveGreedy } from '../../src/solver/greedy'
import { validateSolution } from '../../src/solver/validate'
import { DEFAULT_WEIGHTS } from '../../src/solver/model'
import type { SolverInput } from '../../src/solver/model'
import { makeBuilding, makeGroup, makeRoom, makeSlots, makeTeacher, makeUnit } from '../fixtures/solver'

// Обе половины пары уходят в один слот, поэтому вторая обязана проверяться по состоянию,
// в котором первая уже стоит. Раньше `canPlace` для партнёра шёл по состоянию без неё,
// и пара приземлялась с жёстким нарушением.
describe('placePair: партнёр проверяется с учётом уже поставленной половины', () => {
  function pairInput(a: ReturnType<typeof makeUnit>, b: ReturnType<typeof makeUnit>, teachers: number): SolverInput {
    a.pairedUnitId = b.id
    b.pairedUnitId = a.id
    return {
      units: [a, b],
      teachers: Array.from({ length: teachers }, (_, i) => makeTeacher(i)),
      rooms: [makeRoom(0), makeRoom(1)],
      buildings: [makeBuilding(0)],
      groups: [makeGroup(0, { studentsCount: 30 })],
      slots: makeSlots(),
      fixed: [],
      weights: DEFAULT_WEIGHTS,
      limits: { timeBudgetMs: 2000, maxIterations: 1000, seed: 1 },
    }
  }

  it('пара с одним преподавателем не ставится в общий слот', () => {
    const input = pairInput(
      makeUnit({ id: 5001, teacherIdx: 0, students: 15, attendees: [{ groupIdx: 0, memberMask: [0xffff, 0] }] }),
      makeUnit({ id: 5002, teacherIdx: 0, students: 15, attendees: [{ groupIdx: 0, memberMask: [0xffff0000, 0] }] }),
      1,
    )
    const out = solveGreedy(input)
    expect(validateSolution(input, out)).toEqual([])
    expect(out.assignments).toEqual([])
    expect(out.unplaced.map((u) => u.reason)).toEqual(['paired_unit_failed', 'paired_unit_failed'])
  })

  it('пара с пересекающимися подгруппами не ставится в общий слот', () => {
    const input = pairInput(
      makeUnit({ id: 5003, teacherIdx: 0, students: 20, attendees: [{ groupIdx: 0, memberMask: [0xfffff, 0] }] }),
      makeUnit({ id: 5004, teacherIdx: 1, students: 20, attendees: [{ groupIdx: 0, memberMask: [0xfffff, 0] }] }),
      2,
    )
    const out = solveGreedy(input)
    expect(validateSolution(input, out)).toEqual([])
    expect(out.assignments).toEqual([])
  })

  it('совместимая пара по-прежнему ставится в один слот в разные аудитории', () => {
    const input = pairInput(
      makeUnit({ id: 5007, teacherIdx: 0, students: 15, attendees: [{ groupIdx: 0, memberMask: [0xffff, 0] }] }),
      makeUnit({ id: 5008, teacherIdx: 1, students: 15, attendees: [{ groupIdx: 0, memberMask: [0xffff0000, 0] }] }),
      2,
    )
    const out = solveGreedy(input)
    expect(validateSolution(input, out)).toEqual([])
    expect(out.assignments).toHaveLength(2)
    expect(out.assignments[0]!.slot).toBe(out.assignments[1]!.slot)
    expect(out.assignments[0]!.roomIdx).not.toBe(out.assignments[1]!.roomIdx)
  })
})
