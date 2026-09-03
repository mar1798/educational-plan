/**
 * Детерминированные генераторы входа солвера (§9.2 PLAN.md), чистый TypeScript без БД.
 * Каждая функция строит минимальный, но полный `SolverInput` под конкретный сценарий.
 */
import { DAYS, PAIRS, SLOTS, slotIndex } from '../../src/solver/model'
import type {
  BuildingInfo,
  FixedPlacement,
  GroupInfo,
  RoomInfo,
  RoomType,
  SlotInfo,
  SolverInput,
  TeacherInfo,
  Unit,
} from '../../src/solver/model'
import { DEFAULT_WEIGHTS } from '../../src/solver/model'

export function makeSlots(enabledPairs = PAIRS): SlotInfo[] {
  const slots: SlotInfo[] = []
  for (let day = 1; day <= DAYS; day++) {
    for (let pair = 1; pair <= PAIRS; pair++) {
      slots.push({ idx: slotIndex(day, pair), day, pair, enabled: pair <= enabledPairs, academicHours: 2 })
    }
  }
  return slots
}

export function makeTeacher(idx: number, opts: Partial<TeacherInfo> = {}): TeacherInfo {
  return { idx, id: idx + 1, unavailable: [0, 0], softUnavailable: [], maxPairsPerDay: null, ...opts }
}

export function makeRoom(idx: number, opts: Partial<RoomInfo> = {}): RoomInfo {
  return { idx, id: idx + 1, capacity: 30, roomType: 'practice' as RoomType, buildingIdx: 0, ...opts }
}

export function makeGroup(idx: number, opts: Partial<GroupInfo> = {}): GroupInfo {
  return { idx, id: idx + 1, studentsCount: 25, maxPairsPerDay: 6, maxHoursPerWeek: 45, ...opts }
}

export function makeBuilding(idx: number, opts: Partial<BuildingInfo> = {}): BuildingInfo {
  return { idx, id: idx + 1, clinicalMode: null, ...opts }
}

let unitSeq = 1
export function makeUnit(opts: Partial<Unit> & Pick<Unit, 'teacherIdx'>): Unit {
  return {
    id: unitSeq++,
    loadIdx: 0,
    disciplineIdx: 0,
    difficulty: 1,
    roomTypeRequired: null,
    roomIdFixed: null,
    buildingIdxRequired: null,
    roomOptional: false,
    clinicalMode: null,
    students: 25,
    lessonKind: 'practice',
    parity: 'all',
    pairedUnitId: null,
    attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }],
    ...opts,
  }
}

export function baseLimits(seed = 1) {
  // maxIterations — предохранитель, не рабочий предел (§5.6): бюджет времени исчерпывается раньше.
  return { timeBudgetMs: 10_000, maxIterations: 20_000_000, seed }
}

/** `minimal` (§9.2): 1 группа, 2 преподавателя, 2 кабинета — базовая корректность. */
export function minimalInput(): SolverInput {
  const groups = [makeGroup(0)]
  const teachers = [makeTeacher(0), makeTeacher(1)]
  const rooms = [makeRoom(0), makeRoom(1)]
  const buildings = [makeBuilding(0)]
  const units = [
    makeUnit({ teacherIdx: 0, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] }),
    makeUnit({ teacherIdx: 1, attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }] }),
  ]
  return { units, teachers, rooms, buildings, groups, slots: makeSlots(), fixed: [], weights: DEFAULT_WEIGHTS, limits: baseLimits() }
}

/** `roomy` (§9.2): щедрый запас ресурсов — ожидаем 100% размещения. */
export function roomyInput(groupsCount = 8, unitsPerGroup = 6): SolverInput {
  const groups = Array.from({ length: groupsCount }, (_, i) => makeGroup(i))
  const teachers = Array.from({ length: groupsCount * unitsPerGroup }, (_, i) => makeTeacher(i))
  const rooms = Array.from({ length: groupsCount * 3 }, (_, i) => makeRoom(i, { capacity: 30 }))
  const buildings = [makeBuilding(0)]
  const units: Unit[] = []
  let t = 0
  for (let g = 0; g < groupsCount; g++) {
    for (let u = 0; u < unitsPerGroup; u++) {
      units.push(makeUnit({ teacherIdx: t++, attendees: [{ groupIdx: g, memberMask: [0xffffffff, 0xffffffff] }] }))
    }
  }
  return { units, teachers, rooms, buildings, groups, slots: makeSlots(), fixed: [], weights: DEFAULT_WEIGHTS, limits: baseLimits() }
}

/** `tight` (§9.2): кабинетов впритык, узкие окна преподавателей — часть уходит в unplaced. */
export function tightInput(groupsCount = 6): SolverInput {
  const groups = Array.from({ length: groupsCount }, (_, i) => makeGroup(i, { maxPairsPerDay: 3 }))
  const teachers = Array.from({ length: 3 }, (_, i) => makeTeacher(i, { maxPairsPerDay: 4 }))
  const rooms = [makeRoom(0, { capacity: 25 })]
  const buildings = [makeBuilding(0)]
  const units: Unit[] = []
  for (let g = 0; g < groupsCount; g++) {
    for (let u = 0; u < 4; u++) {
      units.push(makeUnit({ teacherIdx: u % teachers.length, attendees: [{ groupIdx: g, memberMask: [0xffffffff, 0xffffffff] }] }))
    }
  }
  return { units, teachers, rooms, buildings, groups, slots: makeSlots(), fixed: [], weights: DEFAULT_WEIGHTS, limits: baseLimits() }
}

/** `impossible` (§9.2): дисциплина требует кабинет, которого нет — должна корректно уйти в unplaced. */
export function impossibleInput(): SolverInput {
  const groups = [makeGroup(0)]
  const teachers = [makeTeacher(0)]
  const rooms = [makeRoom(0, { roomType: 'practice' })]
  const buildings = [makeBuilding(0)]
  const units = [
    makeUnit({
      teacherIdx: 0,
      roomTypeRequired: 'phantom',
      attendees: [{ groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] }],
    }),
  ]
  return { units, teachers, rooms, buildings, groups, slots: makeSlots(), fixed: [], weights: DEFAULT_WEIGHTS, limits: baseLimits() }
}

/** `subgroups` (§9.2): пересекающиеся нарезки одной группы — параллельные и конфликтующие. */
export function subgroupsInput(): SolverInput {
  const groups = [makeGroup(0, { studentsCount: 30 })]
  const teachers = [makeTeacher(0), makeTeacher(1), makeTeacher(2)]
  const rooms = [makeRoom(0), makeRoom(1)]
  const buildings = [makeBuilding(0)]

  // Схема A: 3 клинические подгруппы по 10 (позиции 0-9, 10-19, 20-29).
  const clinicalSub1: readonly [number, number] = [0b1111111111, 0] // позиции 0..9
  // Схема B: 2 языковые подгруппы по 15 (позиции 0-14, 15-29).
  const langSub2: readonly [number, number] = [0xffffffff & ~0x7fff, 0] // позиции 15..29 within lower 32 bits

  const units = [
    makeUnit({ id: 1001, teacherIdx: 0, students: 10, attendees: [{ groupIdx: 0, memberMask: clinicalSub1 }] }),
    makeUnit({ id: 1002, teacherIdx: 1, students: 15, attendees: [{ groupIdx: 0, memberMask: langSub2 }] }),
  ]
  return { units, teachers, rooms, buildings, groups, slots: makeSlots(), fixed: [], weights: DEFAULT_WEIGHTS, limits: baseLimits() }
}

/** `streams` (§9.2): поток из нескольких групп — один юнит с несколькими attendees. */
export function streamsInput(): SolverInput {
  const groups = [makeGroup(0, { studentsCount: 25 }), makeGroup(1, { studentsCount: 25 }), makeGroup(2, { studentsCount: 25 })]
  const teachers = [makeTeacher(0)]
  const rooms = [makeRoom(0, { capacity: 80, roomType: 'lecture' })]
  const buildings = [makeBuilding(0)]
  const units = [
    makeUnit({
      teacherIdx: 0,
      students: 75,
      roomTypeRequired: 'lecture',
      attendees: [
        { groupIdx: 0, memberMask: [0xffffffff, 0xffffffff] },
        { groupIdx: 1, memberMask: [0xffffffff, 0xffffffff] },
        { groupIdx: 2, memberMask: [0xffffffff, 0xffffffff] },
      ],
    }),
  ]
  return { units, teachers, rooms, buildings, groups, slots: makeSlots(), fixed: [], weights: DEFAULT_WEIGHTS, limits: baseLimits() }
}

/** `limits` (§9.2): группа на 55 (маска 64 позиций), недельный лимит часов, потолок пар преподавателя. */
export function limitsInput(): SolverInput {
  const groups = [makeGroup(0, { studentsCount: 55, maxHoursPerWeek: 4 })]
  const teachers = [makeTeacher(0, { maxPairsPerDay: 1 })]
  const rooms = [makeRoom(0, { capacity: 60 })]
  const buildings = [makeBuilding(0)]
  const fullMask: readonly [number, number] = [0xffffffff, 0x7fffff] // позиции 0..54
  const units = [
    makeUnit({ id: 2001, teacherIdx: 0, students: 55, attendees: [{ groupIdx: 0, memberMask: fullMask }] }),
    makeUnit({ id: 2002, teacherIdx: 0, students: 55, attendees: [{ groupIdx: 0, memberMask: fullMask }] }),
    makeUnit({ id: 2003, teacherIdx: 0, students: 55, attendees: [{ groupIdx: 0, memberMask: fullMask }] }),
  ]
  return { units, teachers, rooms, buildings, groups, slots: makeSlots(), fixed: [], weights: DEFAULT_WEIGHTS, limits: baseLimits() }
}

export function fixedAt(unit: Unit, slot: number, roomIdx: number | null): FixedPlacement {
  return { ...unit, slot, roomIdx }
}

/**
 * `full-college` (§9.2): реалистичный масштаб медколледжа — бенчмарк и приёмка §10
 * (`npm run bench:solver`). 39 групп, ~140 преподавателей, кабинетов с небольшим запасом —
 * не «roomy» и не «tight», типичная нагрузка практического колледжа.
 */
export function fullCollegeInput(): SolverInput {
  const groupsCount = 39
  const teachersCount = 140
  const roomsCount = 55

  const groups = Array.from({ length: groupsCount }, (_, i) => makeGroup(i, { studentsCount: 20 + (i % 15) }))
  const teachers = Array.from({ length: teachersCount }, (_, i) => makeTeacher(i, { maxPairsPerDay: 6 }))
  const roomTypes: RoomType[] = ['practice', 'lecture', 'lab', 'seminar', 'computer']
  const rooms = Array.from({ length: roomsCount }, (_, i) => makeRoom(i, { capacity: 30, roomType: roomTypes[i % roomTypes.length] }))
  const buildings = [makeBuilding(0)]

  const units: Unit[] = []
  let teacherCursor = 0
  const disciplinesPerGroup = 7 // реалистичный недельный набор предметов, не одна дисциплина на все 10 занятий
  for (let g = 0; g < groupsCount; g++) {
    // ~10 недельных занятий на группу — сопоставимо с реальной недельной сеткой семестра.
    for (let u = 0; u < 10; u++) {
      const teacherIdx = teacherCursor % teachersCount
      teacherCursor++
      units.push(
        makeUnit({
          teacherIdx,
          disciplineIdx: u % disciplinesPerGroup,
          roomTypeRequired: roomTypes[u % roomTypes.length],
          attendees: [{ groupIdx: g, memberMask: [0xffffffff, 0xffffffff] }],
        }),
      )
    }
  }

  return { units, teachers, rooms, buildings, groups, slots: makeSlots(), fixed: [], weights: DEFAULT_WEIGHTS, limits: baseLimits() }
}

export { SLOTS }
