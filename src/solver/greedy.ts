/**
 * Начальная жадная расстановка (§5.6, фаза 1 — MVP этапа 5). Юниты берутся most-constrained
 * first, для каждого перебираются допустимые (slot, room) и выбирается вариант с минимальной
 * локальной эвристикой (окна + поздние пары — компактная замена полного пересчёта `penalty.ts`
 * на каждой попытке, см. план этапа 5, «Явные упрощения» п.2). Если ничего не подошло, юнит
 * уходит в `unplaced` с наиболее частой причиной отказа, алгоритм продолжает. Итоговый штраф
 * решения считается уже настоящей функцией §5.5 — в тех же единицах, что и после этапа 6.
 */
import type { BlockReason, SolverHooks, SolverInput, SolverOutput, Unit, UnplacedReason, UnplacedUnit } from './model'
import { PAIRS, slotIndex, WEIGHT_CODES } from './model'
import { allowsNoRoom, candidateRooms, canPlace } from './hard'
import { popcount, Solution, testBit } from './occupancy'
import { computePenalty, type PlacedUnit } from './penalty'
import { Rng } from './rng'

const PROGRESS_INTERVAL_MS = 200

function constrainednessScore(input: SolverInput, unit: Unit): number {
  const roomOptions = candidateRooms(input, unit).length + (allowsNoRoom(unit) ? 1 : 0)
  const teacher = input.teachers[unit.teacherIdx]!
  const teacherFreedom = input.slots.length - popcount(teacher.unavailable)
  // Меньше — «стеснённее», крупные группы идут раньше при прочих равных.
  return roomOptions * 10_000 + teacherFreedom * 100 - unit.students
}

function occupiedPairsInDay(hasBit: (pair: number) => boolean): { min: number; max: number } | null {
  let min = -1
  let max = -1
  for (let p = 1; p <= PAIRS; p++) {
    if (hasBit(p)) {
      if (min === -1) min = p
      max = p
    }
  }
  return min === -1 ? null : { min, max }
}

/** Локальная эвристика (не настраиваемый штраф этапа 6): окна + поздние пары. */
function localScore(input: SolverInput, state: Solution, unit: Unit, slot: number, roomIdx: number | null): number {
  const s = input.slots[slot]!
  let score = s.pair - 1 // лёгкий штраф за позднюю пару

  const teacherRange = occupiedPairsInDay((p) => testBit(state.teacherMask(unit.teacherIdx), slotIndex(s.day, p)))
  score += gapContribution(teacherRange, s.pair)

  for (const a of unit.attendees) {
    const groupRange = occupiedPairsInDay((p) => {
      const m = state.studentMask(a.groupIdx, slotIndex(s.day, p))
      return m[0] !== 0 || m[1] !== 0
    })
    score += gapContribution(groupRange, s.pair)
  }

  if (roomIdx == null) score += 5 // предпочитаем занятие с назначенным кабинетом
  return score
}

function gapContribution(range: { min: number; max: number } | null, pair: number): number {
  if (range === null) return 0
  if (pair >= range.min - 1 && pair <= range.max + 1) return 0
  return Math.min(Math.abs(pair - range.min), Math.abs(pair - range.max))
}

interface BestChoice {
  slot: number
  roomIdx: number | null
  score: number
}

function pickBest(input: SolverInput, state: Solution, unit: Unit, rng: Rng): { best: BestChoice | null; tried: number; blocked: BlockReason[] } {
  let best: BestChoice | null = null
  let bestCount = 0
  let tried = 0
  const blocked: BlockReason[] = []
  const rooms = candidateRooms(input, unit)
  const tryNoRoom = allowsNoRoom(unit)

  // Нет вообще ни одного кандидата на кабинет (тип/здание/вместимость отсекли все) —
  // перебирать слоты бессмысленно, но причина должна попасть в диагностику §5.7.
  if (rooms.length === 0 && !tryNoRoom) {
    return { best: null, tried: input.slots.length, blocked: ['no_room_candidate'] }
  }

  for (const slotInfo of input.slots) {
    const slot = slotInfo.idx
    const roomAttempts: (number | null)[] = [...rooms, ...(tryNoRoom ? [null] : [])]
    for (const roomIdx of roomAttempts) {
      tried++
      const reason = canPlace(input, state, unit, slot, roomIdx)
      if (reason !== null) {
        blocked.push(reason)
        continue
      }
      const score = localScore(input, state, unit, slot, roomIdx)
      if (best === null || score < best.score) {
        best = { slot, roomIdx, score }
        bestCount = 1
      } else if (score === best.score) {
        bestCount++
        // Резервуарная выборка среди равных по счёту — единообразный тай-брейк по seed.
        if (rng.nextInt(bestCount) === 0) best = { slot, roomIdx, score }
      }
    }
  }
  return { best, tried, blocked }
}

function dominantReason(blocked: BlockReason[]): UnplacedReason {
  const counts = new Map<BlockReason, number>()
  for (const b of blocked) counts.set(b, (counts.get(b) ?? 0) + 1)
  let top: BlockReason | null = null
  let topCount = -1
  for (const [reason, count] of counts) {
    if (count > topCount) {
      top = reason
      topCount = count
    }
  }
  switch (top) {
    case 'teacher_unavailable':
      return 'teacher_unavailable'
    case 'group_day_limit':
    case 'teacher_day_limit':
    case 'group_week_hours':
      return 'group_day_limit'
    case 'room_capacity':
    case 'room_type':
    case 'building_mismatch':
    case 'no_room_candidate':
      return 'no_suitable_room'
    default:
      return 'no_free_slot'
  }
}

export function solveGreedy(input: SolverInput, hooks: SolverHooks = {}): SolverOutput {
  const startedAt = Date.now()
  const state = Solution.forInput(input)

  for (const f of input.fixed) {
    const academicHours = input.slots[f.slot]!.academicHours
    state.occupy(f, f.slot, f.roomIdx, academicHours)
  }

  const unitsById = new Map(input.units.map((u) => [u.id, u]))
  const order = [...input.units].sort((a, b) => constrainednessScore(input, a) - constrainednessScore(input, b))

  const rng = new Rng(input.limits.seed)
  const assignments: SolverOutput['assignments'] = []
  const unplaced: UnplacedUnit[] = []
  const handled = new Set<number>()

  let lastProgress = 0
  let processed = 0
  let stoppedBy: SolverOutput['stoppedBy'] = 'completed'

  outer: for (const unit of order) {
    if (handled.has(unit.id)) continue

    if (hooks.isCancelled?.()) {
      stoppedBy = 'cancelled'
      break outer
    }
    if (Date.now() - startedAt > input.limits.timeBudgetMs) {
      stoppedBy = 'time_budget'
      break outer
    }

    processed++
    const now = Date.now()
    if (now - lastProgress > PROGRESS_INTERVAL_MS) {
      lastProgress = now
      hooks.onProgress?.({ percent: Math.round((processed / order.length) * 100), iteration: processed, placed: assignments.length, total: input.units.length, phase: 'greedy' })
    }

    if (unit.pairedUnitId != null) {
      const partner = unitsById.get(unit.pairedUnitId)
      // Ссылка в никуда или уже обработанный партнёр — не повод потерять юнит: ставим его
      // обычным порядком, иначе нарушится инвариант «размещено + не размещено = всего».
      if (!partner || handled.has(partner.id)) {
        placeSingle(input, state, unit, rng, assignments, unplaced)
        handled.add(unit.id)
        continue
      }
      placePair(input, state, unit, partner, rng, assignments, unplaced)
      handled.add(unit.id)
      handled.add(partner.id)
      continue
    }

    placeSingle(input, state, unit, rng, assignments, unplaced)
    handled.add(unit.id)
  }

  // Юниты, до которых очередь не дошла (отмена/бюджет времени) — тоже должны быть учтены,
  // чтобы всегда выполнялось «размещено + не размещено = всего юнитов» (§9.1).
  for (const unit of order) {
    if (!handled.has(unit.id)) {
      unplaced.push({ unitId: unit.id, reason: 'no_free_slot', details: { triedSlots: 0, blockedBy: [] } })
    }
  }

  hooks.onProgress?.({ percent: 100, iteration: processed, placed: assignments.length, total: input.units.length, phase: 'greedy' })

  // Настоящий взвешенный штраф §5.5 (этап 6), а не прежняя заглушка `unplaced.length * 1000`:
  // `state` здесь уже содержит и `fixed`, и всё расставленное, так что пересчёт — один проход.
  // Он нужен, даже когда следом идёт локальный поиск: при отмене на жадной фазе именно этот
  // результат уходит в UI, и показанный там штраф с разбором должен быть настоящим.
  const placed: PlacedUnit[] = assignments.map((a) => ({ unit: unitsById.get(a.unitId)!, slot: a.slot, roomIdx: a.roomIdx }))
  const { total, raw } = computePenalty(input, state, placed, unplaced.length)
  const breakdown: Record<string, number> = { unplaced: unplaced.length }
  for (const [key, dbCode] of Object.entries(WEIGHT_CODES)) breakdown[dbCode] = raw[key as keyof typeof raw]

  return {
    assignments,
    unplaced,
    penalty: total,
    breakdown,
    iterations: processed,
    elapsedMs: Date.now() - startedAt,
    stoppedBy,
  }
}

function placeSingle(
  input: SolverInput,
  state: Solution,
  unit: Unit,
  rng: Rng,
  assignments: SolverOutput['assignments'],
  unplaced: UnplacedUnit[],
): void {
  const { best, tried, blocked } = pickBest(input, state, unit, rng)
  if (best) {
    const academicHours = input.slots[best.slot]!.academicHours
    state.occupy(unit, best.slot, best.roomIdx, academicHours)
    assignments.push({ unitId: unit.id, slot: best.slot, roomIdx: best.roomIdx })
  } else {
    unplaced.push({ unitId: unit.id, reason: dominantReason(blocked), details: { triedSlots: tried, blockedBy: [...new Set(blocked)] } })
  }
}

function placePair(
  input: SolverInput,
  state: Solution,
  a: Unit,
  b: Unit,
  rng: Rng,
  assignments: SolverOutput['assignments'],
  unplaced: UnplacedUnit[],
): void {
  const roomsA = [...candidateRooms(input, a), ...(allowsNoRoom(a) ? [null] : [])]
  const roomsB = [...candidateRooms(input, b), ...(allowsNoRoom(b) ? [null] : [])]

  let best: { slot: number; roomA: number | null; roomB: number | null; score: number } | null = null
  let bestCount = 0
  let tried = 0
  const blocked: BlockReason[] = []

  for (const slotInfo of input.slots) {
    const slot = slotInfo.idx
    for (const roomA of roomsA) {
      tried++
      const reasonA = canPlace(input, state, a, slot, roomA)
      if (reasonA !== null) {
        blocked.push(reasonA)
        continue
      }
      for (const roomB of roomsB) {
        if (roomA != null && roomB === roomA) continue
        const reasonB = canPlace(input, state, b, slot, roomB)
        if (reasonB !== null) {
          blocked.push(reasonB)
          continue
        }
        const score = localScore(input, state, a, slot, roomA) + localScore(input, state, b, slot, roomB)
        if (best === null || score < best.score) {
          best = { slot, roomA, roomB, score }
          bestCount = 1
        } else if (score === best.score) {
          bestCount++
          if (rng.nextInt(bestCount) === 0) best = { slot, roomA, roomB, score }
        }
      }
    }
  }

  if (best) {
    const academicHours = input.slots[best.slot]!.academicHours
    state.occupy(a, best.slot, best.roomA, academicHours)
    state.occupy(b, best.slot, best.roomB, academicHours)
    assignments.push({ unitId: a.id, slot: best.slot, roomIdx: best.roomA })
    assignments.push({ unitId: b.id, slot: best.slot, roomIdx: best.roomB })
  } else {
    const details = { triedSlots: tried, blockedBy: [...new Set(blocked)] }
    unplaced.push({ unitId: a.id, reason: 'paired_unit_failed', details })
    unplaced.push({ unitId: b.id, reason: 'paired_unit_failed', details })
  }
}
