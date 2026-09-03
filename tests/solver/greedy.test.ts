import { describe, expect, it } from 'vitest'
import { solveGreedy } from '../../src/solver/greedy'
import { validateSolution } from '../../src/solver/validate'
import {
  fixedAt,
  impossibleInput,
  limitsInput,
  makeGroup,
  makeRoom,
  makeSlots,
  makeTeacher,
  makeUnit,
  roomyInput,
  streamsInput,
  subgroupsInput,
  tightInput,
} from '../fixtures/solver'
import { DEFAULT_WEIGHTS } from '../../src/solver/model'
import type { SolverInput } from '../../src/solver/model'
import { rangeMask } from '../../src/solver/occupancy'

describe('greedy.solveGreedy', () => {
  it('roomy: размещает 100% юнитов без жёстких нарушений', () => {
    const input = roomyInput()
    const output = solveGreedy(input)
    expect(output.unplaced).toHaveLength(0)
    expect(output.assignments).toHaveLength(input.units.length)
    expect(validateSolution(input, output)).toEqual([])
  })

  it('tight: часть юнитов уходит в unplaced, но без нарушений и без потери часов', () => {
    const input = tightInput()
    const output = solveGreedy(input)
    expect(output.assignments.length + output.unplaced.length).toBe(input.units.length)
    expect(validateSolution(input, output)).toEqual([])
  })

  it('impossible: корректная диагностика, солвер не зависает', () => {
    const input = impossibleInput()
    const start = Date.now()
    const output = solveGreedy(input)
    expect(Date.now() - start).toBeLessThan(1000)
    expect(output.assignments).toHaveLength(0)
    expect(output.unplaced).toHaveLength(1)
    expect(output.unplaced[0]!.reason).toBe('no_suitable_room')
    expect(validateSolution(input, output)).toEqual([])
  })

  it('subgroups: непересекающиеся нарезки размещаются без нарушений', () => {
    const input = subgroupsInput()
    const output = solveGreedy(input)
    expect(output.unplaced).toHaveLength(0)
    expect(validateSolution(input, output)).toEqual([])
  })

  it('streams: поток занимает студентов всех групп-участниц одним юнитом', () => {
    const input = streamsInput()
    const output = solveGreedy(input)
    expect(output.assignments).toHaveLength(1)
    expect(validateSolution(input, output)).toEqual([])
  })

  it('limits: недельный лимит часов группы и потолок пар преподавателя соблюдены', () => {
    const input = limitsInput()
    const output = solveGreedy(input)
    // при лимите 4ч/нед и потолке 1 пары/день у преподавателя не все 3 юнита по 2ч могут встать
    expect(output.assignments.length).toBeLessThan(input.units.length)
    expect(validateSolution(input, output)).toEqual([])
  })

  it('is_locked (fixed) записи — препятствия, не двигаются и не входят в units', () => {
    const group = makeGroup(0)
    const teacher = makeTeacher(0)
    const otherTeacher = makeTeacher(1)
    const room = makeRoom(0)
    const slots = makeSlots()
    const fixedUnit = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] })
    const input: SolverInput = {
      units: [makeUnit({ teacherIdx: 1, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] })],
      teachers: [teacher, otherTeacher],
      rooms: [room],
      buildings: [{ idx: 0, id: 1, clinicalMode: null }],
      groups: [group],
      slots,
      fixed: [fixedAt(fixedUnit, 0, 0)],
      weights: DEFAULT_WEIGHTS,
      limits: { timeBudgetMs: 2000, maxIterations: 1000, seed: 42 },
    }
    const output = solveGreedy(input)
    expect(output.assignments).toHaveLength(1)
    expect(output.assignments[0]!.slot).not.toBe(0) // слот 0 занят fixed-записью (тот же кабинет, одна группа)
    expect(validateSolution(input, output)).toEqual([])
  })

  it('парные подгруппы: обе размещаются в одном слоте, либо обе — в unplaced', () => {
    const group = makeGroup(0, { studentsCount: 30 })
    const teacherA = makeTeacher(0)
    const teacherB = makeTeacher(1)
    const roomA = makeRoom(0)
    const roomB = makeRoom(1)
    const unitA = makeUnit({ id: 501, teacherIdx: 0, students: 15, attendees: [{ groupIdx: 0, memberMask: [0xffff, 0] }], pairedUnitId: 502 })
    const unitB = makeUnit({ id: 502, teacherIdx: 1, students: 15, attendees: [{ groupIdx: 0, memberMask: [0xffff0000, 0] }], pairedUnitId: 501 })
    const input: SolverInput = {
      units: [unitA, unitB],
      teachers: [teacherA, teacherB],
      rooms: [roomA, roomB],
      buildings: [{ idx: 0, id: 1, clinicalMode: null }],
      groups: [group],
      slots: makeSlots(),
      fixed: [],
      weights: DEFAULT_WEIGHTS,
      limits: { timeBudgetMs: 2000, maxIterations: 1000, seed: 7 },
    }
    const output = solveGreedy(input)
    expect(output.assignments).toHaveLength(2)
    const [a, b] = output.assignments
    expect(a!.slot).toBe(b!.slot)
    expect(validateSolution(input, output)).toEqual([])
  })

  it('параллельные подгруппы не удваивают ни часы недели, ни пары дня', () => {
    // Группа 30 человек, две подгруппы по 15, у каждой 6 занятий по 2 ч. Каждый студент
    // набирает ровно 12 ч и 6 пар — при счёте «по группе, а не по студентам» половина
    // занятий упёрлась бы в лимит и ушла в unplaced (§5.4, недельный лимит).
    const teachers = []
    const units = []
    for (let i = 0; i < 12; i++) {
      teachers.push(makeTeacher(i))
      units.push(
        makeUnit({
          teacherIdx: i,
          students: 15,
          attendees: [{ groupIdx: 0, memberMask: i % 2 === 0 ? rangeMask(0, 14) : rangeMask(15, 29) }],
        }),
      )
    }
    const input: SolverInput = {
      units,
      teachers,
      rooms: [makeRoom(0), makeRoom(1)],
      buildings: [{ idx: 0, id: 1, clinicalMode: null }],
      groups: [makeGroup(0, { studentsCount: 30, maxHoursPerWeek: 12, maxPairsPerDay: 6 })],
      slots: makeSlots(),
      fixed: [],
      weights: DEFAULT_WEIGHTS,
      limits: { timeBudgetMs: 5000, maxIterations: 1000, seed: 1 },
    }
    const output = solveGreedy(input)
    expect(output.unplaced).toEqual([])
    expect(validateSolution(input, output)).toEqual([])
  })

  it('битая ссылка pairedUnitId не теряет юнит', () => {
    const input: SolverInput = {
      units: [makeUnit({ id: 901, teacherIdx: 0, pairedUnitId: 999 })], // партнёра нет во входе
      teachers: [makeTeacher(0)],
      rooms: [makeRoom(0)],
      buildings: [{ idx: 0, id: 1, clinicalMode: null }],
      groups: [makeGroup(0)],
      slots: makeSlots(),
      fixed: [],
      weights: DEFAULT_WEIGHTS,
      limits: { timeBudgetMs: 2000, maxIterations: 1000, seed: 3 },
    }
    const output = solveGreedy(input)
    expect(output.assignments.length + output.unplaced.length).toBe(1)
    expect(validateSolution(input, output)).toEqual([])
  })

  it('детерминированность: тот же вход и seed дают идентичный результат', () => {
    const input = tightInput()
    const out1 = solveGreedy(input)
    const out2 = solveGreedy(input)
    expect(out1.assignments).toEqual(out2.assignments)
    expect(out1.unplaced).toEqual(out2.unplaced)
  })

  it('отмена: hooks.isCancelled останавливает расстановку, инвариант часов сохраняется', () => {
    const input = roomyInput()
    let calls = 0
    const output = solveGreedy(input, { isCancelled: () => ++calls > 3 })
    expect(output.stoppedBy).toBe('cancelled')
    expect(output.assignments.length + output.unplaced.length).toBe(input.units.length)
  })
})
