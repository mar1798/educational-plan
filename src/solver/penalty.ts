/**
 * Функция штрафа (§5.5 PLAN.md): все семь… точнее, десять размеченных в `Weights` мягких
 * критериев, каждый — в «сырых» единицах (окна, лишние дни, занятия) плюс взвешенная сумма.
 * Намеренно отдельный проход по состоянию `Solution` (как и `validate.ts` — §9.1 уровень 2):
 * `computePenalty` пересчитывает решение целиком и используется как эталон в тестах локального
 * поиска, а сам поиск (`localSearch.ts`) считает те же величины дельтой по затронутому
 * фрагменту (группа+день, преподаватель+день), не вызывая эту функцию на каждом ходу.
 */
import type { GroupInfo, SolverInput, TeacherInfo, Unit, WeightCode, Weights } from './model'
import { DAYS, PAIRS, POSITIONS, slotIndex } from './model'
import type { Solution } from './occupancy'
import { testBit } from './occupancy'

/** Фиксированный штраф за каждый неразмещённый юнит — вне весов §5.5, вес не настраивается. */
export const UNPLACED_PENALTY = 1000

export interface PlacedUnit {
  unit: Unit
  slot: number
  roomIdx: number | null
}

export type RawBreakdown = Record<WeightCode, number>

export function zeroBreakdown(): RawBreakdown {
  return {
    studentGaps: 0,
    teacherGaps: 0,
    spread: 0,
    difficultyEarly: 0,
    clinicalGrouping: 0,
    teacherPreference: 0,
    latePair: 0,
    clinicalBlockStart: 0,
    roomMissing: 0,
    teacherDays: 0,
  }
}

export function weightedTotal(raw: RawBreakdown, weights: Weights): number {
  let total = 0
  for (const code of Object.keys(raw) as WeightCode[]) total += raw[code] * weights[code]
  return total
}

/** Число «дырок» в занятости за день: пар внутри [min..max], где `hasBit` не выставлен. */
function gapsInDay(hasBit: (pair: number) => boolean): number {
  let min = -1
  let max = -1
  const occupied: boolean[] = []
  for (let pair = 1; pair <= PAIRS; pair++) {
    const on = hasBit(pair)
    occupied.push(on)
    if (on) {
      if (min === -1) min = pair
      max = pair
    }
  }
  if (min === -1) return 0
  let gaps = 0
  for (let p = min; p <= max; p++) if (!occupied[p - 1]) gaps++
  return gaps
}

/** Первая занятая пара дня (1-based) или -1, если день пуст — для `clinical_block_start`. */
function firstOccupiedPair(hasBit: (pair: number) => boolean): number {
  for (let pair = 1; pair <= PAIRS; pair++) if (hasBit(pair)) return pair
  return -1
}

function softViolation(teacher: TeacherInfo, slot: number): number {
  let sum = 0
  for (const rec of teacher.softUnavailable) if (testBit(rec.mask, slot)) sum += rec.weight
  return sum
}

/** §5.5 `student_gaps` для одной позиции студента одного дня. */
export function studentGapsForPosition(state: Solution, groupIdx: number, day: number, position: number): number {
  return gapsInDay((pair) => testBit(state.studentMask(groupIdx, slotIndex(day, pair)), position))
}

/** §5.5 `teacher_gaps` для одного преподавателя одного дня. */
export function teacherGapsForDay(state: Solution, teacherIdx: number, day: number): number {
  return gapsInDay((pair) => testBit(state.teacherMask(teacherIdx), slotIndex(day, pair)))
}

function groupHasAnyStudent(state: Solution, groupIdx: number, day: number, pair: number): boolean {
  const m = state.studentMask(groupIdx, slotIndex(day, pair))
  return m[0] !== 0 || m[1] !== 0
}

/** §5.5 `clinical_grouping` + `clinical_block_start` за неделю одной группы (режим `full_day`, §5.4). */
export function clinicalScoreForGroup(state: Solution, groupIdx: number, group: GroupInfo): { grouping: number; blockStart: number } {
  let daysUsed = 0
  let totalPairs = 0
  let blockStart = 0
  for (let day = 1; day <= DAYS; day++) {
    const gKey = groupIdx * DAYS + (day - 1)
    if (state.clinicalDay[gKey] === -1) continue
    daysUsed++
    const pairs = state.pairsPerDayG[gKey] ?? 0
    totalPairs += pairs
    const first = firstOccupiedPair((pair) => groupHasAnyStudent(state, groupIdx, day, pair))
    if (first > 1) blockStart += first - 1
  }
  const minimalDays = totalPairs > 0 ? Math.ceil(totalPairs / Math.max(1, group.maxPairsPerDay)) : 0
  return { grouping: Math.max(0, daysUsed - minimalDays), blockStart }
}

/** §5.5 `teacher_days`: рабочих дней преподавателя сверх минимально необходимого при его недельной нагрузке. */
export function teacherDaysExcess(state: Solution, teacherIdx: number, teacher: TeacherInfo): number {
  let daysUsed = 0
  let totalPairs = 0
  for (let day = 1; day <= DAYS; day++) {
    const c = state.pairsPerDayT[teacherIdx * DAYS + (day - 1)] ?? 0
    if (c > 0) {
      daysUsed++
      totalPairs += c
    }
  }
  if (totalPairs === 0) return 0
  const cap = Math.max(1, teacher.maxPairsPerDay ?? PAIRS)
  const minimalDays = Math.ceil(totalPairs / cap)
  return Math.max(0, daysUsed - minimalDays)
}

/**
 * Полный пересчёт «сырых» единиц штрафа по уже занятому `state` (жёсткие проверки не
 * повторяются — вызывающая сторона гарантирует, что `placed` уже прошли `hard.ts`).
 * `state` должен содержать и `input.fixed`, и `placed`.
 */
export function computeRawBreakdown(input: SolverInput, state: Solution, placed: readonly PlacedUnit[]): RawBreakdown {
  const raw = zeroBreakdown()

  const spreadCount = new Map<string, number>()
  // Закреплённые (`is_locked`) занятия в `spread` считаются наравне с расставленными: второе
  // занятие той же дисциплины в тот же день у группы — это «размазанная дисциплина» (§5.5)
  // независимо от того, поставил ли его солвер или завуч руками. Именно так их считает и
  // инкрементальный подсчёт в `localSearch.ts`, а расхождение между двумя способами означало
  // бы, что поиск оптимизирует не ту величину, которую потом показывает в отчёте.
  for (const f of input.fixed) {
    const day = input.slots[f.slot]!.day
    for (const a of f.attendees) {
      const key = `${a.groupIdx}|${f.disciplineIdx}|${day}`
      spreadCount.set(key, (spreadCount.get(key) ?? 0) + 1)
    }
  }
  for (const p of placed) {
    const s = input.slots[p.slot]!
    raw.difficultyEarly += p.unit.difficulty * Math.max(0, s.pair - 2)
    if (s.pair >= 5) raw.latePair += 1
    if (p.roomIdx == null) raw.roomMissing += 1
    raw.teacherPreference += softViolation(input.teachers[p.unit.teacherIdx]!, p.slot)

    const day = s.day
    for (const a of p.unit.attendees) {
      const key = `${a.groupIdx}|${p.unit.disciplineIdx}|${day}`
      spreadCount.set(key, (spreadCount.get(key) ?? 0) + 1)
    }
  }
  for (const count of spreadCount.values()) raw.spread += Math.max(0, count - 1)

  for (let g = 0; g < input.groups.length; g++) {
    const group = input.groups[g]!
    for (let day = 1; day <= DAYS; day++) {
      for (let pos = 0; pos < Math.min(group.studentsCount, POSITIONS); pos++) {
        raw.studentGaps += studentGapsForPosition(state, g, day, pos)
      }
    }
    const clinical = clinicalScoreForGroup(state, g, group)
    raw.clinicalGrouping += clinical.grouping
    raw.clinicalBlockStart += clinical.blockStart
  }

  for (let t = 0; t < input.teachers.length; t++) {
    const teacher = input.teachers[t]!
    for (let day = 1; day <= DAYS; day++) raw.teacherGaps += teacherGapsForDay(state, t, day)
    raw.teacherDays += teacherDaysExcess(state, t, teacher)
  }

  return raw
}

export interface PenaltyResult {
  total: number
  raw: RawBreakdown
}

/** Штраф решения целиком: `placed` + `unplacedCount` × `UNPLACED_PENALTY` (§5.5). Дорогая — не для цикла отжига. */
export function computePenalty(input: SolverInput, state: Solution, placed: readonly PlacedUnit[], unplacedCount: number): PenaltyResult {
  const raw = computeRawBreakdown(input, state, placed)
  const total = weightedTotal(raw, input.weights) + unplacedCount * UNPLACED_PENALTY
  return { total, raw }
}
