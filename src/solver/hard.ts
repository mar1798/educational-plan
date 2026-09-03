/**
 * Жёсткие ограничения солвера (§5.4 PLAN.md). `canPlace` — короткозамкнутая проверка одной
 * попытки «поставить unit в (slot, roomIdx)»: возвращает первую нарушенную причину или
 * `null`, если размещение допустимо. Не мутирует состояние — вызывающая сторона (`greedy.ts`)
 * решает, коммитить ли через `Solution.occupy`.
 */
import type { BlockReason, SlotInfo, SolverInput, Unit } from './model'
import { DAYS } from './model'
import type { Solution } from './occupancy'
import { intersects, isEmpty, testBit, withBit } from './occupancy'

export function candidateRooms(input: SolverInput, unit: Unit): number[] {
  if (unit.roomIdFixed != null) {
    const idx = input.rooms.findIndex((r) => r.id === unit.roomIdFixed)
    return idx >= 0 ? [idx] : []
  }
  const list = input.rooms
    .filter((r) => (unit.roomTypeRequired == null || r.roomType === unit.roomTypeRequired))
    .filter((r) => (unit.buildingIdxRequired == null || r.buildingIdx === unit.buildingIdxRequired))
    .filter((r) => r.capacity == null || r.capacity >= unit.students)
    .map((r) => r.idx)
  return list
}

/** true, если для юнита в принципе допустимо не назначать кабинет (используется при переборе). */
export function allowsNoRoom(unit: Unit): boolean {
  return unit.roomOptional
}

function slotOf(slots: readonly SlotInfo[], slot: number): SlotInfo {
  return slots[slot]!
}

export function canPlace(input: SolverInput, state: Solution, unit: Unit, slot: number, roomIdx: number | null): BlockReason | null {
  const s = slotOf(input.slots, slot)
  if (!s.enabled) return 'slot_disabled'

  const teacher = input.teachers[unit.teacherIdx]!
  if (testBit(teacher.unavailable, slot)) return 'teacher_unavailable'
  if (testBit(state.teacherMask(unit.teacherIdx), slot)) return 'teacher_busy'

  for (const a of unit.attendees) {
    if (intersects(state.studentMask(a.groupIdx, slot), a.memberMask)) return 'student_busy'
  }

  if (roomIdx != null) {
    if (testBit(state.roomMask(roomIdx), slot)) return 'room_busy'
    const room = input.rooms[roomIdx]!
    if (room.capacity != null && room.capacity < unit.students) return 'room_capacity'
    if (unit.roomTypeRequired != null && room.roomType !== unit.roomTypeRequired) return 'room_type'
    if (unit.buildingIdxRequired != null && room.buildingIdx !== unit.buildingIdxRequired) return 'building_mismatch'
  } else if (!allowsNoRoom(unit)) {
    return 'no_room_candidate'
  }

  const day = s.day
  // Здание, в котором занятие фактически пройдёт: назначенный кабинет знает точно.
  const effectiveBuilding = roomIdx != null ? (input.rooms[roomIdx]?.buildingIdx ?? null) : unit.buildingIdxRequired

  for (const a of unit.attendees) {
    const group = input.groups[a.groupIdx]
    if (!group) return 'student_busy'
    // Слот, уже занятый параллельной подгруппой той же группы, новой пары дня не добавляет.
    const addsPair = !isEmpty(state.studentMask(a.groupIdx, slot))
      ? false
      : state.pairsPerDayG[a.groupIdx * DAYS + (day - 1)]! >= group.maxPairsPerDay
    if (addsPair) return 'group_day_limit'
    // Недельный лимит — по позициям студентов, иначе параллельные подгруппы удваивают счёт.
    if (state.maxStudentHours(a.groupIdx, a.memberMask) + s.academicHours > group.maxHoursPerWeek) return 'group_week_hours'

    const gKey = a.groupIdx * DAYS + (day - 1)
    const claimedBy = state.clinicalDay[gKey]!
    if (claimedBy !== -1) {
      // День уже отдан клинической базе: у этих студентов не может быть занятий в других
      // зданиях, в том числе занятий без назначенного кабинета (§4 правило 16).
      if (effectiveBuilding !== claimedBy) return 'clinical_conflict'
    } else if (unit.clinicalMode === 'full_day' && effectiveBuilding != null) {
      // Обратная сторона того же правила: занять день базой можно, только если в этот день
      // у группы ещё нет занятий в другом здании.
      const dayUse = state.dayBuildings(a.groupIdx, day)
      if (dayUse.mixed || dayUse.unknown > 0 || (dayUse.single != null && dayUse.single !== effectiveBuilding)) return 'clinical_conflict'
    }
  }

  if (teacher.maxPairsPerDay != null && state.pairsPerDayT[unit.teacherIdx * DAYS + (day - 1)]! >= teacher.maxPairsPerDay) {
    return 'teacher_day_limit'
  }

  return null
}

export function slotBit(slot: number) {
  return withBit([0, 0], slot)
}
