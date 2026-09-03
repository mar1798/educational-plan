import { describe, expect, it } from 'vitest'
import { findConflicts, validateSolution, type SlotEntry } from '../../src/solver/validate'
import { slotIndex } from '../../src/solver/model'
import { makeGroup, makeRoom, makeSlots, makeTeacher, makeUnit, roomyInput } from '../fixtures/solver'
import { DEFAULT_WEIGHTS } from '../../src/solver/model'
import type { SolverInput, SolverOutput } from '../../src/solver/model'

function entry(partial: Partial<SlotEntry> & Pick<SlotEntry, 'id'>): SlotEntry {
  return {
    dayOfWeek: 1,
    pairNo: 1,
    weekParity: 'all',
    teacherId: 1,
    roomId: null,
    attendees: [],
    ...partial,
  }
}

describe('findConflicts (§4.4, §4.6, §5.8)', () => {
  it('ловит занятость преподавателя в тот же слот', () => {
    const candidate = entry({ id: 2, teacherId: 5, attendees: [{ groupId: 1, posFrom: 1, posTo: 30 }] })
    const others = [entry({ id: 1, teacherId: 5, attendees: [{ groupId: 2, posFrom: 1, posTo: 30 }] })]
    expect(findConflicts(candidate, others)).toEqual([{ kind: 'teacher_busy', withEntryId: 1, teacherId: 5 }])
  })

  it('не считает конфликтом другой день или пару', () => {
    const candidate = entry({ id: 2, teacherId: 5, dayOfWeek: 2 })
    const others = [entry({ id: 1, teacherId: 5, dayOfWeek: 1 })]
    expect(findConflicts(candidate, others)).toEqual([])
  })

  it('ловит занятость кабинета в тот же слот', () => {
    const candidate = entry({ id: 2, teacherId: 5, roomId: 10 })
    const others = [entry({ id: 1, teacherId: 6, roomId: 10 })]
    expect(findConflicts(candidate, others)).toEqual([{ kind: 'room_busy', withEntryId: 1, roomId: 10 }])
  })

  it('кабинет не назначен ни там, ни там — не конфликт', () => {
    const candidate = entry({ id: 2, teacherId: 5, roomId: null })
    const others = [entry({ id: 1, teacherId: 6, roomId: null })]
    expect(findConflicts(candidate, others)).toEqual([])
  })

  it('пересекающиеся подгруппы одной группы конфликтуют (§4.6)', () => {
    // клин. п/гр1 [1-10] и англ. п/гр1 [1-15] в один слот — пересечение по позициям 1-10
    const candidate = entry({ id: 2, teacherId: 6, attendees: [{ groupId: 1, posFrom: 1, posTo: 15 }] })
    const others = [entry({ id: 1, teacherId: 7, attendees: [{ groupId: 1, posFrom: 1, posTo: 10 }] })]
    expect(findConflicts(candidate, others)).toEqual([{ kind: 'student_overlap', withEntryId: 1, groupId: 1, overlapFrom: 1, overlapTo: 10 }])
  })

  it('непересекающиеся подгруппы одной группы — не конфликт (5 свободных студентов, §4.6)', () => {
    // клин. п/гр1 [1-10] и англ. п/гр2 [16-30] — свободны
    const candidate = entry({ id: 2, teacherId: 6, attendees: [{ groupId: 1, posFrom: 16, posTo: 30 }] })
    const others = [entry({ id: 1, teacherId: 7, attendees: [{ groupId: 1, posFrom: 1, posTo: 10 }] })]
    expect(findConflicts(candidate, others)).toEqual([])
  })

  it('поток из нескольких групп конфликтует с занятием любой группы-участницы', () => {
    const streamCandidate = entry({
      id: 2,
      teacherId: 9,
      attendees: [
        { groupId: 1, posFrom: 1, posTo: 25 },
        { groupId: 2, posFrom: 1, posTo: 20 },
      ],
    })
    const others = [entry({ id: 1, teacherId: 3, attendees: [{ groupId: 2, posFrom: 1, posTo: 20 }] })]
    expect(findConflicts(streamCandidate, others)).toEqual([{ kind: 'student_overlap', withEntryId: 1, groupId: 2, overlapFrom: 1, overlapTo: 20 }])
  })

  it('weekParity odd/even не пересекаются между собой, но пересекаются с all', () => {
    const oddCandidate = entry({ id: 2, teacherId: 5, weekParity: 'odd' })
    const evenOther = entry({ id: 1, teacherId: 5, weekParity: 'even' })
    expect(findConflicts(oddCandidate, [evenOther])).toEqual([])

    const allOther = entry({ id: 1, teacherId: 5, weekParity: 'all' })
    expect(findConflicts(oddCandidate, [allOther])).toEqual([{ kind: 'teacher_busy', withEntryId: 1, teacherId: 5 }])
  })

  it('кандидат сам с собой (тот же id среди others) не конфликтует', () => {
    const candidate = entry({ id: 1, teacherId: 5 })
    expect(findConflicts(candidate, [candidate])).toEqual([])
  })
})

describe('validateSolution — независимый валидатор решения солвера (§5.4, §9.1 уровень 2)', () => {
  it('чистое решение из greedy не даёт нарушений (перекрёстная проверка через roomyInput)', () => {
    const input = roomyInput(2, 2)
    const output: SolverOutput = {
      assignments: input.units.map((u, i) => ({ unitId: u.id, slot: i, roomIdx: 0 })),
      unplaced: [],
      penalty: 0,
      breakdown: {},
      iterations: 1,
      elapsedMs: 1,
      stoppedBy: 'completed',
    }
    // Намеренно наивное решение (все юниты в разные слоты одного кабинета вместимостью 30,
    // студентов 25 у каждой из 2 групп) — на 2 группы и 4 юнита конфликтов по кабинету/студентам нет.
    expect(validateSolution(input, output)).toEqual([])
  })

  it('ловит специально испорченное решение: два юнита одного преподавателя в одном слоте', () => {
    const teacher = makeTeacher(0)
    const group = makeGroup(0)
    const room = makeRoom(0)
    const unitA = makeUnit({ id: 1, teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [0xffff, 0] }] })
    const unitB = makeUnit({ id: 2, teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [0xffff0000, 0] }] })
    const input: SolverInput = {
      units: [unitA, unitB],
      teachers: [teacher],
      rooms: [room],
      buildings: [{ idx: 0, id: 1, clinicalMode: null }],
      groups: [group],
      slots: makeSlots(),
      fixed: [],
      weights: DEFAULT_WEIGHTS,
      limits: { timeBudgetMs: 1000, maxIterations: 100, seed: 1 },
    }
    const slot = slotIndex(1, 1)
    const output: SolverOutput = {
      assignments: [
        { unitId: 1, slot, roomIdx: 0 },
        { unitId: 2, slot, roomIdx: 0 }, // тот же слот и тот же преподаватель — испорчено намеренно
      ],
      unplaced: [],
      penalty: 0,
      breakdown: {},
      iterations: 1,
      elapsedMs: 1,
      stoppedBy: 'completed',
    }
    const violations = validateSolution(input, output)
    expect(violations.some((v) => v.reason === 'teacher_busy')).toBe(true)
  })

  it('ловит потерянный юнит: отсутствует и в assignments, и в unplaced', () => {
    const teacher = makeTeacher(0)
    const group = makeGroup(0)
    const room = makeRoom(0)
    const unit = makeUnit({ id: 9, teacherIdx: 0 })
    const input: SolverInput = {
      units: [unit],
      teachers: [teacher],
      rooms: [room],
      buildings: [{ idx: 0, id: 1, clinicalMode: null }],
      groups: [group],
      slots: makeSlots(),
      fixed: [],
      weights: DEFAULT_WEIGHTS,
      limits: { timeBudgetMs: 1000, maxIterations: 100, seed: 1 },
    }
    const output: SolverOutput = { assignments: [], unplaced: [], penalty: 0, breakdown: {}, iterations: 0, elapsedMs: 0, stoppedBy: 'completed' }
    const violations = validateSolution(input, output)
    expect(violations).toEqual([{ unitId: 9, reason: 'lost_unit', detail: expect.any(String) }])
  })
})
