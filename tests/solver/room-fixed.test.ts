import { describe, expect, it } from 'vitest'
import { solve } from '../../src/solver'
import { canPlace } from '../../src/solver/hard'
import { Solution } from '../../src/solver/occupancy'
import { validateSolution } from '../../src/solver/validate'
import { DEFAULT_WEIGHTS } from '../../src/solver/model'
import type { SolverInput } from '../../src/solver/model'
import { makeBuilding, makeGroup, makeRoom, makeSlots, makeTeacher, makeUnit } from '../fixtures/solver'

// Закреплённый кабинет держался только `candidateRooms`, а `planSwap`/`planMove` в локальном
// поиске берут кабинет соседнего юнита напрямую — закреплённые занятия уезжали в чужие
// кабинеты, и независимый валидатор этого не видел, потому что тоже не знал про roomIdFixed.
describe('roomIdFixed — жёсткое ограничение', () => {
  function fixedRoomInput(seed: number): SolverInput {
    const rooms = [makeRoom(0), makeRoom(1), makeRoom(2), makeRoom(3), makeRoom(4)]
    const groups = Array.from({ length: 8 }, (_, g) => makeGroup(g, { studentsCount: 25 }))
    const teachers = Array.from({ length: 20 }, (_, t) => makeTeacher(t))
    const units = []
    for (let g = 0; g < 8; g++) {
      for (let k = 0; k < 12; k++) {
        units.push(makeUnit({
          teacherIdx: (g * 12 + k) % 20,
          students: 25,
          // Каждый третий юнит закреплён за кабинетом с idx 0 (id = 1).
          roomIdFixed: k % 3 === 0 ? rooms[0]!.id : null,
          attendees: [{ groupIdx: g, memberMask: [0xffffffff, 0xffffffff] }],
        }))
      }
    }
    return {
      units, teachers, rooms, groups,
      buildings: [makeBuilding(0)],
      slots: makeSlots(),
      fixed: [],
      weights: DEFAULT_WEIGHTS,
      limits: { timeBudgetMs: 1500, maxIterations: 5_000_000, seed },
    }
  }

  it('canPlace отвергает чужой кабинет для закреплённого юнита', () => {
    const input = fixedRoomInput(1)
    const unit = makeUnit({ teacherIdx: 0, roomIdFixed: input.rooms[0]!.id })
    const state = Solution.forInput(input)
    expect(canPlace(input, state, unit, 0, 0)).toBeNull()
    expect(canPlace(input, state, unit, 0, 1)).toBe('room_fixed')
  })

  it.each([1, 2, 3])('solve не срывает закреплённые занятия (seed %i)', async (seed) => {
    const input = fixedRoomInput(seed)
    const out = await solve(input)
    expect(validateSolution(input, out)).toEqual([])

    const byId = new Map(input.units.map((u) => [u.id, u]))
    for (const a of out.assignments) {
      const unit = byId.get(a.unitId)!
      if (unit.roomIdFixed == null || a.roomIdx == null) continue
      expect(input.rooms[a.roomIdx]!.id).toBe(unit.roomIdFixed)
    }
  }, 30000)
})
