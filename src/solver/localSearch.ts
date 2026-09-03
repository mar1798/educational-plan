/**
 * Фаза 2 солвера — локальный поиск имитацией отжига (§5.6 PLAN.md). Стартует с решения
 * жадной фазы (этап 5) и улучшает его ходами `move`/`swap`/`rechair`/`insert`, каждый —
 * с точным взвешенным приростом штрафа (§5.5, `penalty.ts`), посчитанным по затронутому
 * фрагменту решения (группа+день, преподаватель+день, тройка группа-дисциплина-день), а не
 * пересчётом всего решения — так тысячи ходов в бюджет 60 с укладываются по времени.
 *
 * Функция асинхронна и периодически отдаёт управление event loop (`YIELD_INTERVAL_MS`):
 * без этого `isCancelled()`/сообщение 'cancel' от главного процесса (§3.2) не были бы
 * обработаны до конца всего расчёта — жадная фаза короткая и с этим не сталкивалась,
 * поиск же может идти секунды и обязан оставаться отменяемым по ходу (см. комментарий
 * в `solver-host/manager.ts`).
 */
import { allowsNoRoom, candidateRooms, canPlace } from './hard'
import type { Assignment, SolverHooks, SolverInput, SolverOutput, StopReason, Unit, UnplacedUnit } from './model'
import { POSITIONS, slotIndex, WEIGHT_CODES } from './model'
import { intersects, Solution, testBit } from './occupancy'
import {
  clinicalScoreForGroup,
  computeRawBreakdown,
  teacherDaysExcess,
  teacherGapsForDay,
  studentGapsForPosition,
  UNPLACED_PENALTY,
  weightedTotal,
  type PlacedUnit,
  type RawBreakdown,
} from './penalty'
import { Rng } from './rng'

/**
 * Температура падает по доле ПЛАНОВОГО бюджета итераций, не по номеру итерации в лоб (§5.6:
 * «температура падает геометрически» — профиль тот же, просто пересчитанный в доли бюджета).
 * Фиксированная геометрическая скорость на итерацию (как раньше) калибровалась под маленькие
 * входы и остывала почти мгновенно на большом масштабе (полный колледж — миллионы ходов за
 * 60 с) — поиск скатывался в чистое восхождение на первых процентах бюджета, теряя остаток
 * минут впустую. `plannedIterations` ниже — грубая оценка «сколько ходов поместится в бюджет
 * времени», не измерение реальных часов: решение о принятии хода обязано зависеть только от
 * детерминированной последовательности ходов (§5.6 — тот же seed даёт тот же результат), иначе
 * дрожание скорости железа между двумя запусками с одним seed давало бы разные решения.
 */
const COOLING_FLOOR = 0.01
/** Грубая калибровка «итераций в мс» для планового бюджета — см. комментарий к `COOLING_FLOOR`. */
const ASSUMED_ITERATIONS_PER_MS = 100
/** На сколько «рестартов от лучшего» рассчитан плановый бюджет итераций. */
const PLANNED_RESTARTS = 200
/**
 * §5.6 называет «20 000 итераций без улучшения» как один из трёх критериев остановки — но при
 * заметно более дешёвой (по сравнению с расчётом плана), считанной делянкой по затронутому
 * фрагменту итерации это число проходит за доли секунды даже на большом входе, обрывая поиск
 * почти сразу и не давая бюджету времени отработать. Порог растёт с числом юнитов, чтобы
 * «без улучшения» на входе с тысячами юнитов означало заметную часть реального перебора,
 * а не первую сотую бюджета; на маленьких входах низший порог остаётся тем же 20 000.
 */
const NO_IMPROVEMENT_BASE = 20_000
const NO_IMPROVEMENT_PER_UNIT = 3_000
const PROGRESS_INTERVAL_MS = 200
const YIELD_INTERVAL_MS = 50
const INSERT_SAMPLE = 8
const MOVE_SAMPLE = 20
const EVICTED_DETAILS: UnplacedUnit['details'] = { triedSlots: 0, blockedBy: [] }

interface Placement {
  slot: number
  roomIdx: number | null
}

interface PlannedMove {
  unit: Unit
  from: Placement | null
  to: Placement | null
}

/** Простой пул id с O(1) случайным выбором и O(1) удалением (swap-with-last). */
class IdPool {
  private items: number[] = []
  private index = new Map<number, number>()

  add(id: number): void {
    if (this.index.has(id)) return
    this.index.set(id, this.items.length)
    this.items.push(id)
  }

  remove(id: number): void {
    const i = this.index.get(id)
    if (i == null) return
    const last = this.items[this.items.length - 1]!
    this.items.pop()
    this.index.delete(id)
    if (i < this.items.length) {
      this.items[i] = last
      this.index.set(last, i)
    }
  }

  pickRandom(rng: Rng): number | undefined {
    return this.items.length === 0 ? undefined : this.items[rng.nextInt(this.items.length)]
  }

  get size(): number {
    return this.items.length
  }

  values(): number[] {
    return [...this.items]
  }
}

// `tsconfig.solver.json` намеренно не подключает lib DOM/Node (§3.4 изоляция) — оба рантайма,
// в которых реально исполняется этот файл (utility process Electron и vitest/Node в тестах),
// предоставляют `setTimeout` как глобал, поэтому достаточно точечного ambient-объявления,
// а не импорта `node:timers` (запрещён тем же §3.4, см. `isolation.test.ts`).
declare function setTimeout(callback: () => void, ms: number): unknown

/** Отдаёт event loop макротаском — микротаска (`Promise.resolve().then`) не хватило бы: она
 * не даёт обработаться отложенным сообщениям 'cancel' от главного процесса (см. шапку файла). */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Снимок решения на момент запуска локального поиска — жадная фаза (этап 5) уже это посчитала. */
export async function runLocalSearch(input: SolverInput, greedy: SolverOutput, hooks: SolverHooks, startedAt: number): Promise<SolverOutput> {
  const unitsById = new Map(input.units.map((u) => [u.id, u]))
  const weights = input.weights

  let state = Solution.forInput(input)
  for (const f of input.fixed) state.occupy(f, f.slot, f.roomIdx, input.slots[f.slot]!.academicHours)

  let assignments = new Map<number, Placement>()
  let placedPool = new IdPool()
  let unplacedPool = new IdPool()
  let slotOccupants = new Map<number, Set<number>>()
  let spreadCount = new Map<string, number>()

  function addToSpread(groupIdx: number, disciplineIdx: number, day: number, delta: number): void {
    const k = `${groupIdx}|${disciplineIdx}|${day}`
    spreadCount.set(k, (spreadCount.get(k) ?? 0) + delta)
  }

  for (const f of input.fixed) {
    const day = input.slots[f.slot]!.day
    for (const a of f.attendees) addToSpread(a.groupIdx, f.disciplineIdx, day, 1)
  }

  const unplacedReasons = new Map<number, UnplacedUnit>()
  for (const u of greedy.unplaced) unplacedReasons.set(u.unitId, u)

  for (const a of greedy.assignments) {
    const unit = unitsById.get(a.unitId)
    if (!unit) continue
    state.occupy(unit, a.slot, a.roomIdx, input.slots[a.slot]!.academicHours)
    assignments.set(a.unitId, { slot: a.slot, roomIdx: a.roomIdx })
    placedPool.add(a.unitId)
    let occ = slotOccupants.get(a.slot)
    if (!occ) {
      occ = new Set()
      slotOccupants.set(a.slot, occ)
    }
    occ.add(a.unitId)
    const day = input.slots[a.slot]!.day
    for (const att of unit.attendees) addToSpread(att.groupIdx, unit.disciplineIdx, day, 1)
  }
  for (const u of greedy.unplaced) unplacedPool.add(u.unitId)

  const enabledSlots = input.slots.filter((s) => s.enabled).map((s) => s.idx)

  function placedList(): PlacedUnit[] {
    const out: PlacedUnit[] = []
    for (const [id, p] of assignments) out.push({ unit: unitsById.get(id)!, slot: p.slot, roomIdx: p.roomIdx })
    return out
  }

  function scopeValue(key: string): number {
    const parts = key.split('|')
    switch (parts[0]) {
      case 'TD': {
        const t = Number(parts[1])
        const day = Number(parts[2])
        return teacherGapsForDay(state, t, day) * weights.teacherGaps
      }
      case 'TW': {
        const t = Number(parts[1])
        return teacherDaysExcess(state, t, input.teachers[t]!) * weights.teacherDays
      }
      case 'GD': {
        const g = Number(parts[1])
        const day = Number(parts[2])
        const group = input.groups[g]!
        let gaps = 0
        const limit = Math.min(group.studentsCount, POSITIONS)
        for (let pos = 0; pos < limit; pos++) gaps += studentGapsForPosition(state, g, day, pos)
        return gaps * weights.studentGaps
      }
      case 'GW': {
        const g = Number(parts[1])
        const clinical = clinicalScoreForGroup(state, g, input.groups[g]!)
        return clinical.grouping * weights.clinicalGrouping + clinical.blockStart * weights.clinicalBlockStart
      }
      case 'SP': {
        const g = Number(parts[1])
        const disc = Number(parts[2])
        const day = Number(parts[3])
        const count = spreadCount.get(`${g}|${disc}|${day}`) ?? 0
        return Math.max(0, count - 1) * weights.spread
      }
      default:
        return 0
    }
  }

  function sumScopes(keys: Set<string>): number {
    let total = 0
    for (const k of keys) total += scopeValue(k)
    return total
  }

  function collectScopeKeys(unit: Unit, slot: number, into: Set<string>): void {
    const day = input.slots[slot]!.day
    into.add(`TD|${unit.teacherIdx}|${day}`)
    into.add(`TW|${unit.teacherIdx}`)
    for (const a of unit.attendees) {
      into.add(`GD|${a.groupIdx}|${day}`)
      into.add(`GW|${a.groupIdx}`)
      into.add(`SP|${a.groupIdx}|${unit.disciplineIdx}|${day}`)
    }
  }

  function perUnitScore(unit: Unit, slot: number, roomIdx: number | null): number {
    const s = input.slots[slot]!
    let v = unit.difficulty * Math.max(0, s.pair - 2) * weights.difficultyEarly
    if (s.pair >= 5) v += weights.latePair
    if (roomIdx == null) v += weights.roomMissing
    const teacher = input.teachers[unit.teacherIdx]!
    let soft = 0
    for (const rec of teacher.softUnavailable) if (testBit(rec.mask, slot)) soft += rec.weight
    v += soft * weights.teacherPreference
    return v
  }

  /** Диапазон занятых пар дня по грубому признаку «есть хоть один бит» — как в `greedy.ts`,
   * не точный per-position подсчёт `studentGapsForPosition`. Используется только чтобы
   * ДЁШЕВО (без мутации состояния) отранжировать кандидатов на ход — точная дельта всё равно
   * считается через `tryApply` перед принятием хода. */
  function occupiedRange(hasBit: (pair: number) => boolean): { min: number; max: number } | null {
    let min = -1
    let max = -1
    for (let pair = 1; pair <= 6; pair++) {
      if (hasBit(pair)) {
        if (min === -1) min = pair
        max = pair
      }
    }
    return min === -1 ? null : { min, max }
  }

  function gapProxy(range: { min: number; max: number } | null, pair: number): number {
    if (range === null) return 0
    if (pair >= range.min - 1 && pair <= range.max + 1) return 0
    return Math.min(Math.abs(pair - range.min), Math.abs(pair - range.max))
  }

  /** Дешёвая оценка кандидата на слот для `move`/`insert` — направляет случайный перебор
   * в сторону слотов без окон, вместо чисто слепого блуждания (см. шапку файла). */
  function heuristicSlotScore(unit: Unit, slot: number): number {
    const s = input.slots[slot]!
    let score = s.pair - 1
    const teacherRange = occupiedRange((p) => testBit(state.teacherMask(unit.teacherIdx), slotIndex(s.day, p)))
    score += gapProxy(teacherRange, s.pair)
    for (const a of unit.attendees) {
      const groupRange = occupiedRange((p) => {
        const m = state.studentMask(a.groupIdx, slotIndex(s.day, p))
        return m[0] !== 0 || m[1] !== 0
      })
      score += gapProxy(groupRange, s.pair)
    }
    return score
  }

  function occupyAndSpread(unit: Unit, p: Placement): void {
    const hours = input.slots[p.slot]!.academicHours
    state.occupy(unit, p.slot, p.roomIdx, hours)
    const day = input.slots[p.slot]!.day
    for (const a of unit.attendees) addToSpread(a.groupIdx, unit.disciplineIdx, day, 1)
  }

  function vacateAndSpread(unit: Unit, p: Placement): void {
    const hours = input.slots[p.slot]!.academicHours
    state.vacate(unit, p.slot, p.roomIdx, hours)
    const day = input.slots[p.slot]!.day
    for (const a of unit.attendees) addToSpread(a.groupIdx, unit.disciplineIdx, day, -1)
  }

  /** Пробует применить пачку ходов (мутирует `state`/`spreadCount`); при провале жёсткой проверки откатывает сама. */
  function tryApply(moves: PlannedMove[]): number | null {
    let deltaUnplaced = 0
    for (const m of moves) {
      if (!m.from && m.to) deltaUnplaced -= 1
      if (m.from && !m.to) deltaUnplaced += 1
    }

    // Один и тот же набор ключей читается ДО и ПОСЛЕ мутации: слот, который юнит покидает,
    // тоже нужно пересчитать «после» (день мог перестать быть «окном» без этого юнита), а
    // не только слот, куда он встал — иначе побочный эффект на покинутый день теряется.
    const affected = new Set<string>()
    for (const m of moves) {
      if (m.from) collectScopeKeys(m.unit, m.from.slot, affected)
      if (m.to) collectScopeKeys(m.unit, m.to.slot, affected)
    }
    const beforeScopeSum = sumScopes(affected)
    let beforePerUnit = 0
    for (const m of moves) if (m.from) beforePerUnit += perUnitScore(m.unit, m.from.slot, m.from.roomIdx)

    for (const m of moves) if (m.from) vacateAndSpread(m.unit, m.from)

    let failedAt = -1
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i]!
      if (!m.to) continue
      const reason = canPlace(input, state, m.unit, m.to.slot, m.to.roomIdx)
      if (reason !== null) {
        failedAt = i
        break
      }
      occupyAndSpread(m.unit, m.to)
    }

    if (failedAt !== -1) {
      for (let i = 0; i < failedAt; i++) {
        const m = moves[i]!
        if (m.to) vacateAndSpread(m.unit, m.to)
      }
      for (const m of moves) if (m.from) occupyAndSpread(m.unit, m.from)
      return null
    }

    const afterScopeSum = sumScopes(affected)
    let afterPerUnit = 0
    for (const m of moves) if (m.to) afterPerUnit += perUnitScore(m.unit, m.to.slot, m.to.roomIdx)

    return (afterScopeSum - beforeScopeSum) + (afterPerUnit - beforePerUnit) + deltaUnplaced * UNPLACED_PENALTY
  }

  function addOccupant(unitId: number, slot: number): void {
    let s = slotOccupants.get(slot)
    if (!s) {
      s = new Set()
      slotOccupants.set(slot, s)
    }
    s.add(unitId)
  }

  function removeOccupant(unitId: number, slot: number): void {
    const s = slotOccupants.get(slot)
    if (!s) return
    s.delete(unitId)
    if (s.size === 0) slotOccupants.delete(slot)
  }

  function commit(moves: PlannedMove[]): void {
    for (const m of moves) {
      const id = m.unit.id
      if (m.from) removeOccupant(id, m.from.slot)
      if (m.to) {
        addOccupant(id, m.to.slot)
        assignments.set(id, m.to)
        unplacedPool.remove(id)
        placedPool.add(id)
        unplacedReasons.delete(id)
      } else {
        assignments.delete(id)
        placedPool.remove(id)
        unplacedPool.add(id)
        unplacedReasons.set(id, { unitId: id, reason: 'no_free_slot', details: EVICTED_DETAILS })
      }
    }
  }

  function revert(moves: PlannedMove[]): void {
    for (const m of moves) if (m.to) vacateAndSpread(m.unit, m.to)
    for (const m of moves) if (m.from) occupyAndSpread(m.unit, m.from)
  }

  function findBlocker(unit: Unit, slot: number): Unit | null {
    const occupants = slotOccupants.get(slot)
    if (!occupants) return null
    for (const otherId of occupants) {
      const other = unitsById.get(otherId)
      if (!other || other.id === unit.id) continue
      if (other.teacherIdx === unit.teacherIdx) return other
      for (const a of unit.attendees) {
        for (const b of other.attendees) {
          if (a.groupIdx === b.groupIdx && intersects(a.memberMask, b.memberMask)) return other
        }
      }
    }
    return null
  }

  function pickRoom(unit: Unit, rng: Rng, currentRoomIdx: number | null): number | null {
    const rooms = candidateRooms(input, unit)
    const canSkip = allowsNoRoom(unit)
    const pool: (number | null)[] = canSkip ? [...rooms, null] : rooms
    if (pool.length === 0) return null
    if (currentRoomIdx != null && pool.includes(currentRoomIdx) && rng.nextFloat() < 0.5) return currentRoomIdx
    return pool[rng.nextInt(pool.length)]!
  }

  function planMove(rng: Rng): PlannedMove[] | null {
    const unitId = placedPool.pickRandom(rng)
    if (unitId == null) return null
    const unit = unitsById.get(unitId)!
    const from = assignments.get(unitId)!

    // Сэмплируем несколько слотов и берём самый многообещающий по дешёвой эвристике
    // (`heuristicSlotScore`) — на масштабе полного колледжа единственный случайный слот
    // почти всегда только портит решение, и отжиг тонет в потоке бессмысленных ходов.
    let bestSlot = -1
    let bestScore = Infinity
    for (let i = 0; i < MOVE_SAMPLE; i++) {
      const candidate = enabledSlots[rng.nextInt(enabledSlots.length)]!
      if (candidate === from.slot) continue
      const score = heuristicSlotScore(unit, candidate)
      if (score < bestScore) {
        bestScore = score
        bestSlot = candidate
      }
    }
    if (bestSlot === -1) return null
    const roomIdx = pickRoom(unit, rng, from.roomIdx)
    return [{ unit, from, to: { slot: bestSlot, roomIdx } }]
  }

  function planSwap(rng: Rng): PlannedMove[] | null {
    if (placedPool.size < 2) return null
    const idA = placedPool.pickRandom(rng)!
    const idB = placedPool.pickRandom(rng)!
    if (idA === idB) return null
    const unitA = unitsById.get(idA)!
    const unitB = unitsById.get(idB)!
    const posA = assignments.get(idA)!
    const posB = assignments.get(idB)!
    if (posA.slot === posB.slot) return null
    return [
      { unit: unitA, from: posA, to: { slot: posB.slot, roomIdx: posB.roomIdx } },
      { unit: unitB, from: posB, to: { slot: posA.slot, roomIdx: posA.roomIdx } },
    ]
  }

  function planRechair(rng: Rng): PlannedMove[] | null {
    const unitId = placedPool.pickRandom(rng)
    if (unitId == null) return null
    const unit = unitsById.get(unitId)!
    const from = assignments.get(unitId)!
    const rooms = candidateRooms(input, unit)
    const options: (number | null)[] = [...rooms, ...(allowsNoRoom(unit) ? [null] : [])].filter((r) => r !== from.roomIdx)
    if (options.length === 0) return null
    const roomIdx = options[rng.nextInt(options.length)]!
    return [{ unit, from, to: { slot: from.slot, roomIdx } }]
  }

  /** «Insert» из §5.6: сперва прямая вставка в свободное окно, иначе ruin & recreate — вытеснение одного юнита. */
  function planInsert(rng: Rng): PlannedMove[] | null {
    const unitId = unplacedPool.pickRandom(rng)
    if (unitId == null) return null
    const unit = unitsById.get(unitId)!

    const attempts = Math.min(INSERT_SAMPLE, enabledSlots.length)
    const tried = new Set<number>()
    for (let i = 0; i < attempts; i++) {
      const slot = enabledSlots[rng.nextInt(enabledSlots.length)]!
      if (tried.has(slot)) continue
      tried.add(slot)
      const roomIdx = pickRoom(unit, rng, null)
      if (canPlace(input, state, unit, slot, roomIdx) === null) {
        return [{ unit, from: null, to: { slot, roomIdx } }]
      }
    }

    const slot = enabledSlots[rng.nextInt(enabledSlots.length)]!
    const blocker = findBlocker(unit, slot)
    if (!blocker) return null
    const blockerPos = assignments.get(blocker.id)
    if (!blockerPos) return null
    const roomIdx = pickRoom(unit, rng, null)
    return [
      { unit: blocker, from: blockerPos, to: null },
      { unit, from: null, to: { slot, roomIdx } },
    ]
  }

  function pickMoveKind(rng: Rng): 'move' | 'swap' | 'rechair' | 'insert' {
    if (unplacedPool.size > 0 && rng.nextFloat() < 0.35) return 'insert'
    const r = rng.nextFloat()
    if (r < 0.5) return 'move'
    if (r < 0.8) return 'swap'
    return 'rechair'
  }

  function buildMoves(kind: ReturnType<typeof pickMoveKind>, rng: Rng): PlannedMove[] | null {
    switch (kind) {
      case 'move':
        return planMove(rng)
      case 'swap':
        return planSwap(rng)
      case 'rechair':
        return planRechair(rng)
      case 'insert':
        return planInsert(rng)
    }
  }

  const initialRaw = computeRawBreakdown(input, state, placedList())
  let penalty = weightedTotal(initialRaw, weights) + unplacedPool.size * UNPLACED_PENALTY

  interface Snapshot {
    penalty: number
    state: Solution
    assignments: Map<number, Placement>
    placed: number[]
    unplaced: number[]
    spreadCount: Map<string, number>
    unplacedReasons: Map<number, UnplacedUnit>
  }

  function takeSnapshot(): Snapshot {
    return {
      penalty,
      state: state.clone(),
      assignments: new Map(assignments),
      placed: placedPool.values(),
      unplaced: unplacedPool.values(),
      spreadCount: new Map(spreadCount),
      unplacedReasons: new Map(unplacedReasons),
    }
  }

  function poolFrom(ids: number[]): IdPool {
    const pool = new IdPool()
    for (const id of ids) pool.add(id)
    return pool
  }

  function restoreFrom(snap: Snapshot): void {
    state = snap.state.clone()
    assignments = new Map(snap.assignments)
    placedPool = poolFrom(snap.placed)
    unplacedPool = poolFrom(snap.unplaced)
    spreadCount = new Map(snap.spreadCount)
    unplacedReasons.clear()
    for (const [id, u] of snap.unplacedReasons) unplacedReasons.set(id, u)
    slotOccupants = new Map()
    for (const [id, p] of assignments) {
      let occ = slotOccupants.get(p.slot)
      if (!occ) {
        occ = new Set()
        slotOccupants.set(p.slot, occ)
      }
      occ.add(id)
    }
    penalty = snap.penalty
  }

  let best = takeSnapshot()
  const initialTemperature = Math.max(20, penalty * 0.03)
  let temperature = initialTemperature

  const rng = new Rng((input.limits.seed ^ 0x9e3779b9) >>> 0)
  const timeBudget = input.limits.timeBudgetMs
  const maxIterations = input.limits.maxIterations
  const noImprovementLimit = NO_IMPROVEMENT_BASE + input.units.length * NO_IMPROVEMENT_PER_UNIT
  // Остывание и рестарты калибруются по ЧИСЛУ ИТЕРАЦИЙ, а не по `Date.now()`: воспроизводимость
  // (§5.6 — тот же вход и seed дают тот же результат) требует, чтобы решение о принятии хода
  // зависело только от детерминированной последовательности ходов, а не от реальной скорости
  // железа в конкретном запуске. `plannedIterations` — грубая, но фиксированная оценка того,
  // сколько итераций поместится в бюджет времени (см. `ASSUMED_ITERATIONS_PER_MS`), она задаёт
  // темп остывания; фактическая остановка по времени (ниже) остаётся честной проверкой часов.
  const plannedIterations = Math.max(1, timeBudget * ASSUMED_ITERATIONS_PER_MS)
  const restartIdleIterations = Math.max(500, Math.round(plannedIterations / PLANNED_RESTARTS))

  let iterations = 0
  let sinceImprovement = 0
  let sinceRestart = 0
  let stoppedBy: StopReason
  let lastProgress = Date.now()
  let lastYield = Date.now()

  while (true) {
    if (penalty === 0 && unplacedPool.size === 0) {
      stoppedBy = 'completed'
      break
    }
    if (Date.now() - startedAt > timeBudget) {
      stoppedBy = 'time_budget'
      break
    }
    if (iterations >= maxIterations) {
      stoppedBy = 'max_iterations'
      break
    }
    if (sinceImprovement >= noImprovementLimit) {
      stoppedBy = 'no_improvement'
      break
    }
    if (hooks.isCancelled?.()) {
      stoppedBy = 'cancelled'
      break
    }

    iterations++
    const kind = pickMoveKind(rng)
    const moves = buildMoves(kind, rng)
    if (!moves) {
      sinceImprovement++
      sinceRestart++
    } else {
      const delta = tryApply(moves)
      if (delta === null) {
        sinceImprovement++
        sinceRestart++
      } else {
        const accept = delta <= 0 || rng.nextFloat() < Math.exp(-delta / Math.max(temperature, 1e-6))
        if (accept) {
          commit(moves)
          penalty += delta
          if (penalty < best.penalty - 1e-9) {
            best = takeSnapshot()
            sinceImprovement = 0
            sinceRestart = 0
          } else {
            sinceImprovement++
            sinceRestart++
          }
        } else {
          revert(moves)
          sinceImprovement++
          sinceRestart++
        }
      }
    }

    // Геометрическое остывание по доле ПЛАНОВОГО бюджета итераций (см. комментарий выше).
    const plannedFraction = Math.min(1, iterations / plannedIterations)
    temperature = initialTemperature * COOLING_FLOOR ** plannedFraction

    if (sinceRestart >= restartIdleIterations) {
      restoreFrom(best)
      sinceRestart = 0
    }

    const now = Date.now()
    if (now - lastProgress > PROGRESS_INTERVAL_MS) {
      lastProgress = now
      hooks.onProgress?.({
        percent: Math.min(100, Math.round(((now - startedAt) / timeBudget) * 100)),
        iteration: iterations,
        placed: placedPool.size,
        total: input.units.length,
        phase: 'search',
      })
    }
    if (now - lastYield > YIELD_INTERVAL_MS) {
      lastYield = now
      // Отдаём event loop: иначе 'cancel' от главного процесса не будет обработан до конца цикла (см. шапку файла).
      await yieldToEventLoop()
    }
  }

  restoreFrom(best)

  const finalRaw = computeRawBreakdown(input, state, placedList())
  const finalTotal = weightedTotal(finalRaw, weights) + unplacedPool.size * UNPLACED_PENALTY

  const assignmentsOut: Assignment[] = [...assignments.entries()].map(([unitId, p]) => ({ unitId, slot: p.slot, roomIdx: p.roomIdx }))
  const unplacedOut: UnplacedUnit[] = unplacedPool
    .values()
    .map((id) => unplacedReasons.get(id) ?? { unitId: id, reason: 'no_free_slot' as const, details: EVICTED_DETAILS })

  const breakdown: Record<string, number> = { unplaced: unplacedPool.size }
  for (const [code, dbCode] of Object.entries(WEIGHT_CODES)) breakdown[dbCode] = finalRaw[code as keyof RawBreakdown]

  return {
    assignments: assignmentsOut,
    unplaced: unplacedOut,
    penalty: finalTotal,
    breakdown,
    iterations: greedy.iterations + iterations,
    elapsedMs: Date.now() - startedAt,
    stoppedBy,
  }
}
