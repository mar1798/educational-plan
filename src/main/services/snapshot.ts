/**
 * Сборка входа солвера (§3.3, §5.5 PLAN.md) — единственное место, где домен (БД) встречается
 * с чистым `solver/*`. Собирает `SolverInput` для конкретной версии шаблона: активные
 * справочники и нагрузка семестра как числовые индексы, уже стоящие `is_locked=1` записи
 * как препятствия (`fixed`), а недостающие часы нагрузки — как `units` по формуле §5.2.
 */
import { and, eq, isNull } from 'drizzle-orm'
import type { FixedPlacement, RoomType, SolverInput, Unit, UnitAttendee } from '../../solver/model'
import { DEFAULT_WEIGHTS, PAIRS, POSITIONS, slotIndex } from '../../solver/model'
import { rangeMask } from '../../solver/occupancy'
import { semester } from '../db/schema/calendar'
import { curriculumRow, discipline } from '../db/schema/curriculum'
import { teachingLoad } from '../db/schema/load'
import { building, pairGrid, room } from '../db/schema/org'
import { studyGroup, teacher, teacherAbsence } from '../db/schema/people'
import { scheduleTemplate, templateEntry } from '../db/schema/schedule'
import { NotFoundError } from '../db/repo/base-repo'
import { resolveEntryAttendees } from '../db/repo/schedule-template'
import type { DbLike } from '../db/repo/types'

const DAYS = 6

function buildSlots(tx: DbLike) {
  const rows = tx.select().from(pairGrid).all()
  const byPair = new Map(rows.map((r) => [r.pairNo, r]))
  const slots = []
  for (let day = 1; day <= DAYS; day++) {
    for (let pair = 1; pair <= PAIRS; pair++) {
      const row = byPair.get(pair)
      slots.push({ idx: slotIndex(day, pair), day, pair, enabled: row?.enabled ?? true, academicHours: row?.academicHours ?? 2 })
    }
  }
  return slots
}

function unavailabilityMask(rows: { dayOfWeek: number | null; pairFrom: number; pairTo: number }[]): readonly [number, number] {
  let mask: readonly [number, number] = [0, 0]
  for (const a of rows) {
    if (a.dayOfWeek == null) continue
    for (let p = a.pairFrom; p <= a.pairTo; p++) {
      mask = unionBit(mask, slotIndex(a.dayOfWeek, p))
    }
  }
  return mask
}

function unionBit(mask: readonly [number, number], bit: number): readonly [number, number] {
  return bit < 32 ? [mask[0] | (1 << bit), mask[1]] : [mask[0], mask[1] | (1 << (bit - 32))]
}

/** База/остаток недельных занятий из плановых часов (§5.2). */
function lessonsFromHours(hoursPlanned: number, weeksCount: number): { base: number; rest: number } {
  const lessonsTotal = Math.ceil(hoursPlanned / 2)
  const base = Math.floor(lessonsTotal / weeksCount)
  const rest = lessonsTotal - weeksCount * base
  return { base, rest }
}

/** Чётность для «довеска» недельных занятий: ближе по числу недель к нужному остатку. */
function extraParity(rest: number, weeksCount: number): 'odd' | 'even' {
  const evenWeeks = Math.floor(weeksCount / 2)
  return rest > evenWeeks ? 'odd' : 'even'
}

export function buildSolverInput(tx: DbLike, templateId: number, seed = Date.now()): SolverInput {
  const tmpl = tx.select().from(scheduleTemplate).where(eq(scheduleTemplate.id, templateId)).get()
  if (!tmpl) throw new NotFoundError('schedule_template', templateId)
  const sem = tx.select().from(semester).where(eq(semester.id, tmpl.semesterId)).get()
  if (!sem) throw new NotFoundError('semester', tmpl.semesterId)

  const buildingRows = tx.select().from(building).all()
  const buildingIdxById = new Map(buildingRows.map((b, idx) => [b.id, idx]))
  const buildings = buildingRows.map((b, idx) => ({ idx, id: b.id, clinicalMode: b.clinicalMode }))

  const roomRows = tx.select().from(room).where(isNull(room.validTo)).all()
  const roomIdxById = new Map(roomRows.map((r, idx) => [r.id, idx]))
  const rooms = roomRows.map((r, idx) => ({
    idx,
    id: r.id,
    capacity: r.capacity,
    roomType: r.roomType as RoomType,
    buildingIdx: buildingIdxById.get(r.buildingId) ?? 0,
  }))

  const groupRows = tx.select().from(studyGroup).where(isNull(studyGroup.validTo)).all()
  const groupIdxById = new Map(groupRows.map((g, idx) => [g.id, idx]))
  const groups = groupRows.map((g, idx) => ({ idx, id: g.id, studentsCount: g.studentsCount, maxPairsPerDay: g.maxPairsPerDay, maxHoursPerWeek: g.maxHoursPerWeek }))

  const teacherRows = tx.select().from(teacher).all()
  const teacherIdxById = new Map(teacherRows.map((t, idx) => [t.id, idx]))
  const absenceRows = tx.select().from(teacherAbsence).where(and(eq(teacherAbsence.scope, 'weekday'), eq(teacherAbsence.kind, 'hard'))).all()
  const absencesByTeacher = new Map<number, typeof absenceRows>()
  for (const a of absenceRows) {
    const list = absencesByTeacher.get(a.teacherId) ?? []
    list.push(a)
    absencesByTeacher.set(a.teacherId, list)
  }
  const teachers = teacherRows.map((t, idx) => ({
    idx,
    id: t.id,
    unavailable: unavailabilityMask(absencesByTeacher.get(t.id) ?? []),
    maxPairsPerDay: t.maxPairsPerDay,
  }))

  const slots = buildSlots(tx)

  /**
   * Слушатели строки нагрузки как индексы солвера. Группа, которой нет среди активных
   * (закрыта, объединена в другую), индекса не имеет — такой слушатель отбрасывается, иначе
   * в солвер уехал бы groupIdx = -1 и обрушил бы обращения к массивам занятости.
   */
  function attendeesFor(loadId: number): UnitAttendee[] {
    const out: UnitAttendee[] = []
    for (const a of resolveEntryAttendees(tx, loadId)) {
      const groupIdx = groupIdxById.get(a.groupId)
      if (groupIdx == null) continue
      // Позиции студентов не помещаются в 64 бита маски — обрезаем по последней доступной.
      const posTo = Math.min(a.posTo, POSITIONS)
      if (a.posFrom > posTo) continue
      out.push({ groupIdx, memberMask: rangeMask(a.posFrom - 1, posTo - 1) })
    }
    return out
  }

  // ── уже стоящие (is_locked=1) записи шаблона — препятствия, не входят в units.
  const lockedEntries = tx.select().from(templateEntry).where(and(eq(templateEntry.templateId, templateId), eq(templateEntry.isLocked, true))).all()
  const lockedCountByLoad = new Map<number, number>()
  const fixed: FixedPlacement[] = []
  for (const e of lockedEntries) {
    const load = tx.select().from(teachingLoad).where(eq(teachingLoad.id, e.teachingLoadId)).get()
    if (!load) continue
    lockedCountByLoad.set(load.id, (lockedCountByLoad.get(load.id) ?? 0) + 1)
    const unit = unitFromLoad(load, 'all', e.id * -1)
    if (!unit) continue
    fixed.push({ ...unit, slot: slotIndex(e.dayOfWeek, e.pairNo), roomIdx: e.roomId != null ? roomIdxById.get(e.roomId) ?? null : null })
  }

  function unitFromLoad(load: typeof teachingLoad.$inferSelect, parity: 'all' | 'odd' | 'even', id: number): Unit | null {
    const row = tx.select().from(curriculumRow).where(eq(curriculumRow.id, load.curriculumRowId)).get()
    const disc = row ? tx.select().from(discipline).where(eq(discipline.id, row.disciplineId)).get() : undefined
    const teacherIdx = teacherIdxById.get(load.teacherId)
    if (teacherIdx == null) return null
    const attendees = attendeesFor(load.id)
    // Ни одной активной группы у строки нагрузки — юнита нет (иначе занятие «ни для кого»).
    if (attendees.length === 0) return null
    const students = attendees.reduce((sum, a) => {
      // memberMask — позиции 0-based; считаем биты через popcount на два слова.
      return sum + popcount32(a.memberMask[0]) + popcount32(a.memberMask[1])
    }, 0)
    const buildingIdxRequired = load.buildingIdRequired != null ? buildingIdxById.get(load.buildingIdRequired) ?? null : null
    const requiredBuilding = buildingIdxRequired != null ? buildingRows[buildingIdxRequired] : undefined
    return {
      id,
      loadIdx: load.id,
      teacherIdx,
      attendees,
      disciplineIdx: disc?.id ?? 0,
      difficulty: disc?.difficulty ?? 1,
      roomTypeRequired: (load.roomTypeRequired as RoomType | null) ?? (disc?.defaultRoomType as RoomType | null) ?? null,
      roomIdFixed: load.roomIdFixed ?? null,
      buildingIdxRequired,
      roomOptional: load.roomTypeRequired == null && load.roomIdFixed == null,
      clinicalMode: load.clinicalModeOverride ?? requiredBuilding?.clinicalMode ?? null,
      students,
      lessonKind: load.lessonKind,
      parity,
      pairedUnitId: null,
    }
  }

  function popcount32(n: number): number {
    let x = n - ((n >>> 1) & 0x55555555)
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
    x = (x + (x >>> 4)) & 0x0f0f0f0f
    return (x * 0x01010101) >>> 24
  }

  // ── недостающая нагрузка семестра → units (§5.2).
  const loads = tx.select().from(teachingLoad).where(and(eq(teachingLoad.semesterId, tmpl.semesterId), isNull(teachingLoad.validTo))).all()

  const units: Unit[] = []
  const unitIdsByLoad = new Map<number, number[]>()
  let nextId = 1

  for (const load of loads) {
    const { base, rest } = lessonsFromHours(load.hoursPlanned, sem.weeksCount)
    const locked = lockedCountByLoad.get(load.id) ?? 0
    const wantedAll = base
    const wantedExtra = rest > 0 ? 1 : 0
    const totalWanted = wantedAll + wantedExtra
    const needed = Math.max(0, totalWanted - locked)

    const ids: number[] = []
    for (let i = 0; i < needed; i++) {
      const isExtra = i >= wantedAll - Math.min(locked, wantedAll)
      const parity = isExtra ? extraParity(rest, sem.weeksCount) : 'all'
      const unit = unitFromLoad(load, parity, nextId++)
      if (unit) {
        units.push(unit)
        ids.push(unit.id)
      }
    }
    unitIdsByLoad.set(load.id, ids)
  }

  // ── парные подгруппы (§4.3 requiresParallel/pairedLoadId): связываем только когда у обеих
  // сторон ровно одно недельное занятие — иначе связка неоднозначна (см. план этапа 5).
  for (const load of loads) {
    if (load.pairedLoadId == null) continue
    const mine = unitIdsByLoad.get(load.id) ?? []
    const theirs = unitIdsByLoad.get(load.pairedLoadId) ?? []
    if (mine.length === 1 && theirs.length === 1) {
      const a = units.find((u) => u.id === mine[0])
      const b = units.find((u) => u.id === theirs[0])
      if (a && b) {
        a.pairedUnitId = b.id
        b.pairedUnitId = a.id
      }
    }
  }

  return {
    units,
    teachers,
    rooms,
    buildings,
    groups,
    slots,
    fixed,
    weights: DEFAULT_WEIGHTS,
    limits: { timeBudgetMs: 60_000, maxIterations: 200_000, seed },
  }
}
