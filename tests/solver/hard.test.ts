import { describe, expect, it } from 'vitest'
import { canPlace } from '../../src/solver/hard'
import { slotIndex } from '../../src/solver/model'
import { rangeMask, Solution, withBit } from '../../src/solver/occupancy'
import { makeGroup, makeRoom, makeSlots, makeTeacher, makeUnit } from '../fixtures/solver'
import type { SolverInput } from '../../src/solver/model'
import { DEFAULT_WEIGHTS } from '../../src/solver/model'

function baseInput(overrides: Partial<SolverInput> = {}): SolverInput {
  return {
    units: [],
    teachers: [makeTeacher(0)],
    rooms: [makeRoom(0)],
    buildings: [{ idx: 0, id: 1, clinicalMode: null }],
    groups: [makeGroup(0)],
    slots: makeSlots(),
    fixed: [],
    weights: DEFAULT_WEIGHTS,
    limits: { timeBudgetMs: 1000, maxIterations: 100, seed: 1 },
    ...overrides,
  }
}

describe('hard.canPlace — по одному тесту на ограничение (§5.4)', () => {
  it('слот выключен', () => {
    const input = baseInput({ slots: makeSlots(4) }) // пары 5-6 выключены
    const unit = makeUnit({ teacherIdx: 0 })
    const state = Solution.forInput(input)
    expect(canPlace(input, state, unit, slotIndex(1, 5), 0)).toBe('slot_disabled')
  })

  it('преподаватель недоступен (жёсткая маска)', () => {
    const slot = slotIndex(1, 1)
    const input = baseInput({ teachers: [makeTeacher(0, { unavailable: withBit([0, 0], slot) })] })
    const unit = makeUnit({ teacherIdx: 0 })
    const state = Solution.forInput(input)
    expect(canPlace(input, state, unit, slot, 0)).toBe('teacher_unavailable')
  })

  it('преподаватель уже занят', () => {
    const input = baseInput()
    const slot = slotIndex(1, 1)
    const unit = makeUnit({ teacherIdx: 0 })
    const other = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [0, 0] }] })
    const state = Solution.forInput(input)
    state.occupy(other, slot, null, 2)
    expect(canPlace(input, state, unit, slot, 0)).toBe('teacher_busy')
  })

  it('студенты уже заняты (пересечение позиций)', () => {
    const input = baseInput()
    const slot = slotIndex(1, 1)
    const unit = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: rangeMask(0, 9) }] })
    const other = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: rangeMask(5, 14) }] })
    const state = Solution.forInput(input)
    state.occupy(other, slot, null, 2)
    // разные преподаватели, чтобы не спутать с teacher_busy
    const input2 = baseInput({ teachers: [makeTeacher(0), makeTeacher(1)] })
    const unit2 = { ...unit, teacherIdx: 1 }
    expect(canPlace(input2, state, unit2, slot, 0)).toBe('student_busy')
  })

  it('кабинет занят', () => {
    const input = baseInput({ teachers: [makeTeacher(0), makeTeacher(1)] })
    const slot = slotIndex(1, 1)
    const state = Solution.forInput(input)
    const other = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [0, 0] }] })
    state.occupy(other, slot, 0, 2)
    const unit = makeUnit({ teacherIdx: 1, attendees: [{ groupIdx: 0, memberMask: [0, 0] }] })
    expect(canPlace(input, state, unit, slot, 0)).toBe('room_busy')
  })

  it('вместимость кабинета мала', () => {
    const input = baseInput({ rooms: [makeRoom(0, { capacity: 10 })] })
    const unit = makeUnit({ teacherIdx: 0, students: 25 })
    const state = Solution.forInput(input)
    expect(canPlace(input, state, unit, slotIndex(1, 1), 0)).toBe('room_capacity')
  })

  it('тип кабинета не совпадает', () => {
    const input = baseInput({ rooms: [makeRoom(0, { roomType: 'lab' })] })
    const unit = makeUnit({ teacherIdx: 0, roomTypeRequired: 'phantom' })
    const state = Solution.forInput(input)
    expect(canPlace(input, state, unit, slotIndex(1, 1), 0)).toBe('room_type')
  })

  it('здание не совпадает', () => {
    const input = baseInput({ rooms: [makeRoom(0, { buildingIdx: 0 })] })
    const unit = makeUnit({ teacherIdx: 0, buildingIdxRequired: 1 })
    const state = Solution.forInput(input)
    expect(canPlace(input, state, unit, slotIndex(1, 1), 0)).toBe('building_mismatch')
  })

  it('лимит пар в день у группы', () => {
    const input = baseInput({ groups: [makeGroup(0, { maxPairsPerDay: 1 })] })
    const unit1 = makeUnit({ teacherIdx: 0 })
    const state = Solution.forInput(input)
    state.occupy(unit1, slotIndex(1, 1), null, 2)
    const unit2 = makeUnit({ teacherIdx: 0 })
    expect(canPlace(input, state, unit2, slotIndex(1, 2), 0)).toBe('group_day_limit')
  })

  it('лимит пар в день у преподавателя', () => {
    const input = baseInput({ teachers: [makeTeacher(0, { maxPairsPerDay: 1 })] })
    const unit1 = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [0, 0] }] })
    const state = Solution.forInput(input)
    state.occupy(unit1, slotIndex(1, 1), null, 2)
    const unit2 = makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [0, 0] }] })
    expect(canPlace(input, state, unit2, slotIndex(1, 2), 0)).toBe('teacher_day_limit')
  })

  it('недельный лимит часов у группы', () => {
    const input = baseInput({ groups: [makeGroup(0, { maxHoursPerWeek: 2 })] })
    const unit1 = makeUnit({ teacherIdx: 0 })
    const state = Solution.forInput(input)
    state.occupy(unit1, slotIndex(1, 1), null, 2)
    const unit2 = makeUnit({ teacherIdx: 0 })
    expect(canPlace(input, state, unit2, slotIndex(1, 2), 0)).toBe('group_week_hours')
  })

  it('режим full_day на клинической базе запрещает другое здание в тот же день', () => {
    const input = baseInput({
      rooms: [makeRoom(0, { buildingIdx: 1 }), makeRoom(1, { buildingIdx: 0 })],
      buildings: [{ idx: 0, id: 1, clinicalMode: null }, { idx: 1, id: 2, clinicalMode: 'full_day' }],
    })
    const clinicalUnit = makeUnit({ teacherIdx: 0, clinicalMode: 'full_day', buildingIdxRequired: 1 })
    const state = Solution.forInput(input)
    state.occupy(clinicalUnit, slotIndex(1, 1), 0, 2)

    const collegeUnit = makeUnit({ teacherIdx: 0 })
    expect(canPlace(input, state, collegeUnit, slotIndex(1, 2), 1)).toBe('clinical_conflict')

    // а в том же здании — можно
    const anotherClinicalUnit = makeUnit({ teacherIdx: 0, clinicalMode: 'full_day', buildingIdxRequired: 1 })
    expect(canPlace(input, state, anotherClinicalUnit, slotIndex(1, 2), 0)).toBeNull()
  })

  it('full_day не занимает день, в котором у группы уже есть занятие в другом здании', () => {
    const input = baseInput({
      rooms: [makeRoom(0, { buildingIdx: 1 }), makeRoom(1, { buildingIdx: 0 })],
      buildings: [{ idx: 0, id: 1, clinicalMode: null }, { idx: 1, id: 2, clinicalMode: 'full_day' }],
    })
    const state = Solution.forInput(input)
    // сначала обычное занятие в корпусе колледжа
    state.occupy(makeUnit({ teacherIdx: 0 }), slotIndex(1, 1), 1, 2)

    const clinicalUnit = makeUnit({ teacherIdx: 0, clinicalMode: 'full_day', buildingIdxRequired: 1 })
    expect(canPlace(input, state, clinicalUnit, slotIndex(1, 2), 0)).toBe('clinical_conflict')
    // в другой день — пожалуйста
    expect(canPlace(input, state, clinicalUnit, slotIndex(2, 1), 0)).toBeNull()
  })

  it('в день full_day можно поставить занятие без требования здания, но в кабинете той же базы', () => {
    const input = baseInput({
      rooms: [makeRoom(0, { buildingIdx: 1 }), makeRoom(1, { buildingIdx: 1 })],
      buildings: [{ idx: 0, id: 1, clinicalMode: null }, { idx: 1, id: 2, clinicalMode: 'full_day' }],
      teachers: [makeTeacher(0), makeTeacher(1)],
    })
    const state = Solution.forInput(input)
    state.occupy(makeUnit({ teacherIdx: 0, clinicalMode: 'full_day', buildingIdxRequired: 1 }), slotIndex(1, 1), 0, 2)

    const anyUnit = makeUnit({ teacherIdx: 1 })
    expect(canPlace(input, state, anyUnit, slotIndex(1, 2), 1)).toBeNull()
  })

  it('без нарушений — размещение разрешено', () => {
    const input = baseInput()
    const unit = makeUnit({ teacherIdx: 0 })
    const state = Solution.forInput(input)
    expect(canPlace(input, state, unit, slotIndex(1, 1), 0)).toBeNull()
  })
})
