/**
 * Битовые маски занятости (§5.3 PLAN.md): 36 слотов и до 64 позиций студентов не помещаются
 * в один 32-битный integer, поэтому любая маска — два слова. Здесь же живёт изменяемое
 * состояние решения (`Solution`), которое `greedy.ts` мутирует при коммите/откате юнита.
 */
import type { BitMask64, GroupInfo, RoomInfo, SlotInfo, SolverInput, TeacherInfo, Unit } from './model'
import { DAYS, POSITIONS, SLOTS } from './model'

export function testBit(mask: BitMask64, bit: number): boolean {
  const word = bit < 32 ? mask[0] : mask[1]
  return (word & (1 << (bit % 32))) !== 0
}

export function withBit(mask: BitMask64, bit: number): BitMask64 {
  return bit < 32 ? [mask[0] | (1 << bit), mask[1]] : [mask[0], mask[1] | (1 << (bit - 32))]
}

export function withoutBit(mask: BitMask64, bit: number): BitMask64 {
  return bit < 32 ? [mask[0] & ~(1 << bit), mask[1]] : [mask[0], mask[1] & ~(1 << (bit - 32))]
}

export function rangeMask(from: number, to: number): BitMask64 {
  let m: BitMask64 = [0, 0]
  for (let i = from; i <= to; i++) m = withBit(m, i)
  return m
}

export function intersects(a: BitMask64, b: BitMask64): boolean {
  return (a[0] & b[0]) !== 0 || (a[1] & b[1]) !== 0
}

export function union(a: BitMask64, b: BitMask64): BitMask64 {
  return [a[0] | b[0], a[1] | b[1]]
}

export function popcount32(n: number): number {
  let x = n - ((n >>> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  x = (x + (x >>> 4)) & 0x0f0f0f0f
  return (x * 0x01010101) >>> 24
}

export function popcount(mask: BitMask64): number {
  return popcount32(mask[0]) + popcount32(mask[1])
}

export function isEmpty(mask: BitMask64): boolean {
  return mask[0] === 0 && mask[1] === 0
}

/** Обходит установленные биты маски (позиции студентов 0..63) — без аллокаций. */
export function forEachBit(mask: BitMask64, fn: (bit: number) => void): void {
  for (let word = 0; word < 2; word++) {
    let w = mask[word]! >>> 0
    while (w !== 0) {
      const low = w & -w
      const bit = 31 - Math.clz32(low >>> 0)
      fn(word * 32 + bit)
      w = (w & ~low) >>> 0
    }
  }
}

/**
 * Изменяемое состояние размещения (§5.3). Индексы совпадают с idx-полями входа
 * (`teacherIdx`, `roomIdx`, `groupIdx`, `slot`). `studentBusy` индексируется по
 * `(groupIdx * SLOTS + slot) * 2` — маска занятых позиций именно в этом слоте у этой
 * группы (ключевая проверка §5.3: «занятость студентов, а не подгруппы»).
 */
export class Solution {
  readonly teacherBusy: Uint32Array // 2 слова на преподавателя
  readonly roomBusy: Uint32Array // 2 слова на кабинет
  readonly studentBusy: Uint32Array // 2 слова на (groupIdx, slot)
  readonly pairsPerDayG: Uint8Array // [groupIdx * DAYS + (day-1)] — ЗАНЯТЫХ СЛОТОВ, а не занятий
  readonly pairsPerDayT: Uint8Array // [teacherIdx * DAYS + (day-1)]
  /**
   * Часы недели, накопленные каждой позицией студента: [groupIdx * POSITIONS + pos].
   * Именно по позициям, а не по группе целиком, — иначе параллельные подгруппы удваивают
   * счёт и группа впустую упирается в недельный лимит (§5.4, строка «Недельный лимит»).
   */
  readonly studentHoursG: Float64Array
  readonly clinicalDay: Int32Array // [groupIdx * DAYS + (day-1)] — buildingIdx, занявший день, -1 = свободно
  /**
   * Сколько занятий режима `full_day` держат день группы за каждым зданием:
   * [(groupIdx * DAYS + day-1) * buildings + b]. Именно счётчик, а не «защёлка» в
   * `clinicalDay`: снимать притязание базы на день нужно, когда ушло последнее её
   * `full_day`-занятие, а не когда в здании не осталось вообще никаких занятий группы —
   * иначе `vacate` не отменяет свой `occupy` и день остаётся запертым за базой навсегда.
   */
  readonly clinicalCount: Int32Array
  /** Сколько занятий дня у группы прошло в каждом здании: [(groupIdx * DAYS + day-1) * buildings + b]. */
  readonly dayBuildingCount: Int32Array
  /** Занятия дня без известного здания (кабинет не назначен и здание не требуется). */
  readonly dayNoBuildingCount: Int32Array

  /** Единственный способ создать состояние под конкретный вход — не забыть про здания. */
  static forInput(input: SolverInput): Solution {
    return new Solution(input.teachers, input.rooms, input.groups, input.slots, input.buildings.length)
  }

  /** Публично — нужно `localSearch.ts`, чтобы клонировать состояние под снимок «лучшего решения» (§5.6 рестарты). */
  readonly buildingsCount: number

  constructor(
    readonly teachers: readonly TeacherInfo[],
    readonly rooms: readonly RoomInfo[],
    readonly groups: readonly GroupInfo[],
    readonly slots: readonly SlotInfo[],
    buildingsCount = 1,
  ) {
    this.buildingsCount = Math.max(1, buildingsCount)
    this.teacherBusy = new Uint32Array(teachers.length * 2)
    this.roomBusy = new Uint32Array(rooms.length * 2)
    this.studentBusy = new Uint32Array(groups.length * SLOTS * 2)
    this.pairsPerDayG = new Uint8Array(groups.length * DAYS)
    this.pairsPerDayT = new Uint8Array(teachers.length * DAYS)
    this.studentHoursG = new Float64Array(groups.length * POSITIONS)
    this.clinicalDay = new Int32Array(groups.length * DAYS).fill(-1)
    this.clinicalCount = new Int32Array(groups.length * DAYS * this.buildingsCount)
    this.dayBuildingCount = new Int32Array(groups.length * DAYS * this.buildingsCount)
    this.dayNoBuildingCount = new Int32Array(groups.length * DAYS)
  }

  /** Глубокая копия для снимка «лучшего решения» (§5.6 рестарты локального поиска) — только typed arrays, дёшево. */
  clone(): Solution {
    const copy = new Solution(this.teachers, this.rooms, this.groups, this.slots, this.buildingsCount)
    copy.teacherBusy.set(this.teacherBusy)
    copy.roomBusy.set(this.roomBusy)
    copy.studentBusy.set(this.studentBusy)
    copy.pairsPerDayG.set(this.pairsPerDayG)
    copy.pairsPerDayT.set(this.pairsPerDayT)
    copy.studentHoursG.set(this.studentHoursG)
    copy.clinicalDay.set(this.clinicalDay)
    copy.clinicalCount.set(this.clinicalCount)
    copy.dayBuildingCount.set(this.dayBuildingCount)
    copy.dayNoBuildingCount.set(this.dayNoBuildingCount)
    return copy
  }

  private setMask(arr: Uint32Array, base: number, mask: BitMask64, on: boolean): void {
    if (on) {
      arr[base] = (arr[base]! | mask[0]) >>> 0
      arr[base + 1] = (arr[base + 1]! | mask[1]) >>> 0
    } else {
      arr[base] = (arr[base]! & ~mask[0]) >>> 0
      arr[base + 1] = (arr[base + 1]! & ~mask[1]) >>> 0
    }
  }

  private maskAt(arr: Uint32Array, base: number): BitMask64 {
    return [arr[base]!, arr[base + 1]!]
  }

  teacherMask(teacherIdx: number): BitMask64 {
    return this.maskAt(this.teacherBusy, teacherIdx * 2)
  }

  roomMask(roomIdx: number): BitMask64 {
    return this.maskAt(this.roomBusy, roomIdx * 2)
  }

  studentMask(groupIdx: number, slot: number): BitMask64 {
    return this.maskAt(this.studentBusy, (groupIdx * SLOTS + slot) * 2)
  }

  /** Максимум накопленных часов среди позиций маски — то, во что упрётся недельный лимит. */
  maxStudentHours(groupIdx: number, mask: BitMask64): number {
    let max = 0
    const base = groupIdx * POSITIONS
    forEachBit(mask, (bit) => {
      const h = this.studentHoursG[base + bit]!
      if (h > max) max = h
    })
    return max
  }

  /** Здание, которое ещё держит день группы своими `full_day`-занятиями, или -1. */
  private claimingBuilding(dayKey: number): number {
    for (let b = 0; b < this.buildingsCount; b++) {
      if (this.clinicalCount[dayKey * this.buildingsCount + b]! > 0) return b
    }
    return -1
  }

  /** Здание, в котором у группы уже есть занятия в этот день, или null; `mixed` — их несколько. */
  dayBuildings(groupIdx: number, day: number): { single: number | null; mixed: boolean; unknown: number } {
    const dayKey = groupIdx * DAYS + (day - 1)
    let single: number | null = null
    let distinct = 0
    for (let b = 0; b < this.buildingsCount; b++) {
      if (this.dayBuildingCount[dayKey * this.buildingsCount + b]! > 0) {
        distinct++
        if (single === null) single = b
      }
    }
    return { single: distinct === 1 ? single : null, mixed: distinct > 1, unknown: this.dayNoBuildingCount[dayKey]! }
  }

  /**
   * Здание, в котором юнит фактически окажется: назначенный кабинет знает его точно,
   * иначе — требуемое зданием нагрузки, иначе неизвестно (кабинет не назначается).
   */
  private buildingOf(unit: Unit, roomIdx: number | null): number | null {
    if (roomIdx != null) return this.rooms[roomIdx]?.buildingIdx ?? null
    return unit.buildingIdxRequired
  }

  /** Занять ресурсы под юнит в (slot, roomIdx) — вызывается только после успешной проверки hard.ts. */
  occupy(unit: Unit, slot: number, roomIdx: number | null, academicHours: number): void {
    const slotBit: BitMask64 = withBit([0, 0], slot)
    this.setMask(this.teacherBusy, unit.teacherIdx * 2, slotBit, true)
    if (roomIdx != null) this.setMask(this.roomBusy, roomIdx * 2, slotBit, true)

    const day = this.slots[slot]!.day
    const tKey = unit.teacherIdx * DAYS + (day - 1)
    this.pairsPerDayT[tKey] = (this.pairsPerDayT[tKey] ?? 0) + 1
    const buildingIdx = this.buildingOf(unit, roomIdx)

    for (const a of unit.attendees) {
      const base = (a.groupIdx * SLOTS + slot) * 2
      // Пара дня считается один раз на слот: параллельные подгруппы одной группы занимают
      // один и тот же слот и не должны съедать лимит дважды (§5.4).
      const wasFree = isEmpty(this.studentMask(a.groupIdx, slot))
      this.setMask(this.studentBusy, base, a.memberMask, true)
      const gKey = a.groupIdx * DAYS + (day - 1)
      if (wasFree) this.pairsPerDayG[gKey] = (this.pairsPerDayG[gKey] ?? 0) + 1

      const hoursBase = a.groupIdx * POSITIONS
      forEachBit(a.memberMask, (bit) => {
        this.studentHoursG[hoursBase + bit] = this.studentHoursG[hoursBase + bit]! + academicHours
      })

      if (buildingIdx != null) {
        const k = gKey * this.buildingsCount + buildingIdx
        this.dayBuildingCount[k] = this.dayBuildingCount[k]! + 1
      } else {
        this.dayNoBuildingCount[gKey] = this.dayNoBuildingCount[gKey]! + 1
      }

      if (unit.clinicalMode === 'full_day' && buildingIdx != null) {
        const c = gKey * this.buildingsCount + buildingIdx
        this.clinicalCount[c] = this.clinicalCount[c]! + 1
        this.clinicalDay[gKey] = buildingIdx
      }
    }
  }

  /** Откатить занятие ресурсов (для перебора вариантов «попробовать — не подошло — вернуть»). */
  vacate(unit: Unit, slot: number, roomIdx: number | null, academicHours: number): void {
    const slotBit: BitMask64 = withBit([0, 0], slot)
    this.setMask(this.teacherBusy, unit.teacherIdx * 2, slotBit, false)
    if (roomIdx != null) this.setMask(this.roomBusy, roomIdx * 2, slotBit, false)

    const day = this.slots[slot]!.day
    const tKey = unit.teacherIdx * DAYS + (day - 1)
    this.pairsPerDayT[tKey] = (this.pairsPerDayT[tKey] ?? 0) - 1
    const buildingIdx = this.buildingOf(unit, roomIdx)

    for (const a of unit.attendees) {
      const base = (a.groupIdx * SLOTS + slot) * 2
      this.setMask(this.studentBusy, base, a.memberMask, false)
      const gKey = a.groupIdx * DAYS + (day - 1)
      if (isEmpty(this.studentMask(a.groupIdx, slot))) this.pairsPerDayG[gKey] = (this.pairsPerDayG[gKey] ?? 0) - 1

      const hoursBase = a.groupIdx * POSITIONS
      forEachBit(a.memberMask, (bit) => {
        this.studentHoursG[hoursBase + bit] = this.studentHoursG[hoursBase + bit]! - academicHours
      })

      if (buildingIdx != null) {
        const k = gKey * this.buildingsCount + buildingIdx
        this.dayBuildingCount[k] = this.dayBuildingCount[k]! - 1
      } else {
        this.dayNoBuildingCount[gKey] = this.dayNoBuildingCount[gKey]! - 1
      }

      if (unit.clinicalMode === 'full_day' && buildingIdx != null) {
        // День перестаёт быть «занятым базой», когда ушло последнее её `full_day`-занятие.
        const c = gKey * this.buildingsCount + buildingIdx
        this.clinicalCount[c] = this.clinicalCount[c]! - 1
        this.clinicalDay[gKey] = this.claimingBuilding(gKey)
      }
    }
  }
}
