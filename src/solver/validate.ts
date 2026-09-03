/**
 * Единственный источник истины по жёстким конфликтам (§5.8 PLAN.md), используемый в трёх
 * местах: 1) renderer при перетаскивании (оптимистичная подсветка), 2) main как авторитетная
 * проверка перед записью, 3) тесты солвера как независимый арбитр качества.
 *
 * Файл сознательно делится на два независимых слоя, которые не переиспользуют код друг
 * друга:
 * - `findConflicts` — уровень *материализованных* записей шаблона (преподаватель/кабинет/
 *   пересечение подгрупп, §4.4, §4.6) — обслуживает места 1 и 2;
 * - `validateSolution` — уровень *солвера* (Unit/Assignment, §5.4) — независимый валидатор
 *   §9.1 (место 3): переcчитывает занятость с нуля собственным, намеренно отдельным от
 *   `occupancy.ts`/`hard.ts` кодом. Если бы валидатор использовал те же функции, что и
 *   `greedy.ts`, общая ошибка в них осталась бы незамеченной.
 */
import type { BlockReason, GroupInfo, SolverInput, SolverOutput, Unit } from './model'

export interface SlotAttendee {
  groupId: number
  posFrom: number
  posTo: number
}

export interface SlotEntry {
  id: number
  dayOfWeek: number
  pairNo: number
  weekParity: 'all' | 'odd' | 'even'
  teacherId: number
  roomId: number | null
  attendees: SlotAttendee[]
}

export type ConflictReason =
  | { kind: 'teacher_busy'; withEntryId: number; teacherId: number }
  | { kind: 'room_busy'; withEntryId: number; roomId: number }
  | { kind: 'student_overlap'; withEntryId: number; groupId: number; overlapFrom: number; overlapTo: number }

function parityOverlaps(a: SlotEntry['weekParity'], b: SlotEntry['weekParity']): boolean {
  return a === 'all' || b === 'all' || a === b
}

function studentOverlaps(candidate: SlotEntry, other: SlotEntry): ConflictReason[] {
  const reasons: ConflictReason[] = []
  for (const a of candidate.attendees) {
    for (const b of other.attendees) {
      if (a.groupId !== b.groupId) continue
      const from = Math.max(a.posFrom, b.posFrom)
      const to = Math.min(a.posTo, b.posTo)
      if (from <= to) {
        reasons.push({ kind: 'student_overlap', withEntryId: other.id, groupId: a.groupId, overlapFrom: from, overlapTo: to })
      }
    }
  }
  return reasons
}

/**
 * Жёсткие конфликты кандидата `candidate` с уже расставленными записями `others`
 * (кандидат исключается вызывающей стороной, если он уже есть среди `others`).
 */
export function findConflicts(candidate: SlotEntry, others: SlotEntry[]): ConflictReason[] {
  const reasons: ConflictReason[] = []

  for (const other of others) {
    if (other.id === candidate.id) continue
    if (other.dayOfWeek !== candidate.dayOfWeek || other.pairNo !== candidate.pairNo) continue
    if (!parityOverlaps(candidate.weekParity, other.weekParity)) continue

    if (other.teacherId === candidate.teacherId) {
      reasons.push({ kind: 'teacher_busy', withEntryId: other.id, teacherId: other.teacherId })
    }
    if (candidate.roomId != null && other.roomId != null && candidate.roomId === other.roomId) {
      reasons.push({ kind: 'room_busy', withEntryId: other.id, roomId: other.roomId })
    }
    reasons.push(...studentOverlaps(candidate, other))
  }

  return reasons
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Независимый валидатор решения солвера (§5.4, §9.1 уровень 2). Ниже — собственные,
// намеренно простые и не заимствованные из occupancy.ts/hard.ts структуры данных.

/** Помимо жёстких причин §5.4, валидатор ловит структурные аномалии решения. */
export type ViolationReason = BlockReason | 'unknown_unit' | 'duplicate_unit' | 'lost_unit'

export interface SolverViolation {
  unitId: number
  reason: ViolationReason
  detail: string
}

function bitAt(mask: readonly [number, number], bit: number): boolean {
  const word = bit < 32 ? mask[0] : mask[1]
  return (word & (1 << (bit % 32))) !== 0
}

function overlaps(a: readonly [number, number], b: readonly [number, number]): boolean {
  return (a[0] & b[0]) !== 0 || (a[1] & b[1]) !== 0
}

/**
 * Пересчитывает решение солвера с нуля и заново проверяет каждое жёсткое ограничение §5.4.
 * Инвариант всех тестов солвера: любой `SolverOutput`, возвращённый `solve()`, проходит эту
 * функцию без единого нарушения и без потерянных/задвоенных юнитов.
 */
export function validateSolution(input: SolverInput, output: SolverOutput): SolverViolation[] {
  const violations: SolverViolation[] = []

  const unitsById = new Map(input.units.map((u) => [u.id, u]))
  const seen = new Set<number>()

  const teacherSlot = new Map<string, number>() // `${teacherIdx}-${slot}` -> unitId
  const roomSlot = new Map<string, number>() // `${roomIdx}-${slot}` -> unitId
  const studentSlot = new Map<string, [number, number]>() // `${groupIdx}-${slot}` -> occupied mask
  const occupiedSlotsG = new Set<string>() // `${groupIdx}-${slot}` — слот, где группа уже занята
  const pairsPerDayG = new Map<string, number>() // `${groupIdx}-${day}` — ЗАНЯТЫХ СЛОТОВ за день
  const pairsPerDayT = new Map<string, number>() // `${teacherIdx}-${day}`
  const studentHours = new Map<string, number>() // `${groupIdx}-${position}` -> часы недели
  const clinicalDay = new Map<string, number>() // `${groupIdx}-${day}` -> buildingIdx
  const dayBuildings = new Map<string, Map<number | null, number>>() // `${groupIdx}-${day}` -> здание -> занятий

  /** Здание, в котором занятие фактически пройдёт (кабинет знает точно), или null. */
  function buildingOf(unit: Unit, roomIdx: number | null): number | null {
    if (roomIdx != null) return input.rooms[roomIdx]?.buildingIdx ?? null
    return unit.buildingIdxRequired
  }

  function positionsOf(mask: readonly [number, number]): number[] {
    const out: number[] = []
    for (let bit = 0; bit < 64; bit++) if (bitAt(mask, bit)) out.push(bit)
    return out
  }

  /** Максимум часов среди позиций маски — недельный лимит считается по студентам (§5.4). */
  function maxHoursIn(groupIdx: number, mask: readonly [number, number]): number {
    let max = 0
    for (const pos of positionsOf(mask)) max = Math.max(max, studentHours.get(`${groupIdx}-${pos}`) ?? 0)
    return max
  }

  function applyOccupation(unit: Unit, slot: number, roomIdx: number | null): void {
    const s = input.slots[slot]
    const day = s ? s.day : Math.floor(slot / 6) + 1
    teacherSlot.set(`${unit.teacherIdx}-${slot}`, unit.id)
    if (roomIdx != null) roomSlot.set(`${roomIdx}-${slot}`, unit.id)
    pairsPerDayT.set(`${unit.teacherIdx}-${day}`, (pairsPerDayT.get(`${unit.teacherIdx}-${day}`) ?? 0) + 1)
    const building = buildingOf(unit, roomIdx)
    for (const a of unit.attendees) {
      const key = `${a.groupIdx}-${slot}`
      const prev = studentSlot.get(key) ?? [0, 0]
      studentSlot.set(key, [prev[0] | a.memberMask[0], prev[1] | a.memberMask[1]])
      // Пара дня — на занятый слот, а не на занятие: параллельные подгруппы делят слот.
      if (!occupiedSlotsG.has(key)) {
        occupiedSlotsG.add(key)
        pairsPerDayG.set(`${a.groupIdx}-${day}`, (pairsPerDayG.get(`${a.groupIdx}-${day}`) ?? 0) + 1)
      }
      for (const pos of positionsOf(a.memberMask)) {
        const hKey = `${a.groupIdx}-${pos}`
        studentHours.set(hKey, (studentHours.get(hKey) ?? 0) + (s?.academicHours ?? 2))
      }
      const dKey = `${a.groupIdx}-${day}`
      const perBuilding = dayBuildings.get(dKey) ?? new Map<number | null, number>()
      perBuilding.set(building, (perBuilding.get(building) ?? 0) + 1)
      dayBuildings.set(dKey, perBuilding)
      if (unit.clinicalMode === 'full_day' && building != null) {
        clinicalDay.set(dKey, building)
      }
    }
  }

  // Занять ресурсы под уже стоящие (is_locked) записи — они не проверяются (не юниты
  // солвера), но занимают место, с которым должны считаться назначения ниже.
  for (const f of input.fixed) {
    applyOccupation(f, f.slot, f.roomIdx)
  }

  for (const a of output.assignments) {
    const unit = unitsById.get(a.unitId)
    if (!unit) {
      violations.push({ unitId: a.unitId, reason: 'unknown_unit', detail: 'назначение ссылается на неизвестный unitId' })
      continue
    }
    if (seen.has(unit.id)) {
      violations.push({ unitId: unit.id, reason: 'duplicate_unit', detail: 'юнит размещён более одного раза' })
    }
    seen.add(unit.id)

    const s = input.slots[a.slot]
    if (!s || !s.enabled) {
      violations.push({ unitId: unit.id, reason: 'slot_disabled', detail: `слот ${a.slot} выключен или не существует` })
      continue
    }

    const teacher = input.teachers[unit.teacherIdx]
    if (teacher && bitAt(teacher.unavailable, a.slot)) {
      violations.push({ unitId: unit.id, reason: 'teacher_unavailable', detail: 'преподаватель недоступен в этот слот' })
    }
    const teacherKey = `${unit.teacherIdx}-${a.slot}`
    if (teacherSlot.has(teacherKey) && teacherSlot.get(teacherKey) !== unit.id) {
      violations.push({ unitId: unit.id, reason: 'teacher_busy', detail: `преподаватель уже занят юнитом #${teacherSlot.get(teacherKey)}` })
    }

    for (const att of unit.attendees) {
      const occupied = studentSlot.get(`${att.groupIdx}-${a.slot}`)
      if (occupied && overlaps(occupied, att.memberMask)) {
        violations.push({ unitId: unit.id, reason: 'student_busy', detail: `студенты группы #${att.groupIdx} уже заняты в этот слот` })
      }
    }

    if (a.roomIdx != null) {
      const roomKey = `${a.roomIdx}-${a.slot}`
      if (roomSlot.has(roomKey) && roomSlot.get(roomKey) !== unit.id) {
        violations.push({ unitId: unit.id, reason: 'room_busy', detail: `кабинет уже занят юнитом #${roomSlot.get(roomKey)}` })
      }
      const room = input.rooms[a.roomIdx]
      if (room) {
        if (room.capacity != null && room.capacity < unit.students) {
          violations.push({ unitId: unit.id, reason: 'room_capacity', detail: `вместимость ${room.capacity} меньше ${unit.students}` })
        }
        if (unit.roomTypeRequired != null && room.roomType !== unit.roomTypeRequired) {
          violations.push({ unitId: unit.id, reason: 'room_type', detail: `нужен тип «${unit.roomTypeRequired}», кабинет — «${room.roomType}»` })
        }
        if (unit.buildingIdxRequired != null && room.buildingIdx !== unit.buildingIdxRequired) {
          violations.push({ unitId: unit.id, reason: 'building_mismatch', detail: 'кабинет не в требуемом здании' })
        }
      }
    } else if (!unit.roomOptional) {
      violations.push({ unitId: unit.id, reason: 'no_room_candidate', detail: 'кабинет обязателен, но не назначен' })
    }

    const day = s.day
    const building = buildingOf(unit, a.roomIdx)
    for (const att of unit.attendees) {
      const group: GroupInfo | undefined = input.groups[att.groupIdx]
      if (group) {
        const addsPair = !occupiedSlotsG.has(`${att.groupIdx}-${a.slot}`)
        const gDay = (pairsPerDayG.get(`${att.groupIdx}-${day}`) ?? 0) + (addsPair ? 1 : 0)
        if (gDay > group.maxPairsPerDay) {
          violations.push({ unitId: unit.id, reason: 'group_day_limit', detail: `группа #${att.groupIdx}: пар в день больше лимита ${group.maxPairsPerDay}` })
        }
        const hours = maxHoursIn(att.groupIdx, att.memberMask) + s.academicHours
        if (hours > group.maxHoursPerWeek) {
          violations.push({ unitId: unit.id, reason: 'group_week_hours', detail: `группа #${att.groupIdx}: часов в неделю больше лимита ${group.maxHoursPerWeek}` })
        }
      }
      const dKey = `${att.groupIdx}-${day}`
      const claimedBy = clinicalDay.get(dKey)
      if (claimedBy != null) {
        if (building !== claimedBy) {
          violations.push({ unitId: unit.id, reason: 'clinical_conflict', detail: `день у группы #${att.groupIdx} уже занят другим зданием` })
        }
      } else if (unit.clinicalMode === 'full_day' && building != null) {
        const used = [...(dayBuildings.get(dKey)?.entries() ?? [])].filter(([, n]) => n > 0).map(([b]) => b)
        if (used.some((b) => b !== building)) {
          violations.push({ unitId: unit.id, reason: 'clinical_conflict', detail: `день у группы #${att.groupIdx} уже занят занятиями вне базы` })
        }
      }
    }

    if (teacher?.maxPairsPerDay != null) {
      const tDay = (pairsPerDayT.get(`${unit.teacherIdx}-${day}`) ?? 0) + 1
      if (tDay > teacher.maxPairsPerDay) {
        violations.push({ unitId: unit.id, reason: 'teacher_day_limit', detail: `преподаватель: пар в день больше лимита ${teacher.maxPairsPerDay}` })
      }
    }

    applyOccupation(unit, a.slot, a.roomIdx)
  }

  for (const u of output.unplaced) seen.add(u.unitId)

  for (const unit of input.units) {
    if (!seen.has(unit.id)) {
      violations.push({ unitId: unit.id, reason: 'lost_unit', detail: 'юнит отсутствует и в assignments, и в unplaced — часы потеряны' })
    }
  }

  return violations
}
