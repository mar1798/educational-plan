/**
 * Бенчмарк солвера (§9.1 уровень 5, §10 PLAN.md), два прогона на `full-college`:
 * 1) жадная фаза (этап 5) одна — должна укладываться в 3 секунды и не давать жёстких нарушений;
 * 2) жадная фаза + локальный поиск (этап 6, бюджет 60 с) — штраф должен упасть минимум
 *    на 40 % относительно жадной фазы (в тех же единицах — реальный взвешенный штраф §5.5,
 *    а не грубая заглушка `unplaced.length * 1000`, которой пользуется одна жадная фаза
 *    до появления `penalty.ts`) при том же бюджете 60 с — это и есть «Готово когда» этапа 6.
 * Запуск: `npm run bench:solver`.
 */
import { solve } from '../../src/solver'
import { solveGreedy } from '../../src/solver/greedy'
import { Solution } from '../../src/solver/occupancy'
import { computePenalty } from '../../src/solver/penalty'
import { validateSolution } from '../../src/solver/validate'
import { fullCollegeInput } from '../fixtures/solver'
import type { SolverInput, SolverOutput } from '../../src/solver/model'

const GREEDY_TIME_BUDGET_MS = 3000
const SEARCH_TIME_BUDGET_MS = 60_000
const MIN_IMPROVEMENT = 0.4

/** Настоящий взвешенный штраф (§5.5) решения жадной фазы — для честного сравнения с этапом 6. */
function realPenalty(input: SolverInput, output: SolverOutput): number {
  const unitsById = new Map(input.units.map((u) => [u.id, u]))
  const state = Solution.forInput(input)
  for (const f of input.fixed) state.occupy(f, f.slot, f.roomIdx, input.slots[f.slot]!.academicHours)
  const placed = []
  for (const a of output.assignments) {
    const unit = unitsById.get(a.unitId)!
    state.occupy(unit, a.slot, a.roomIdx, input.slots[a.slot]!.academicHours)
    placed.push({ unit, slot: a.slot, roomIdx: a.roomIdx })
  }
  return computePenalty(input, state, placed, output.unplaced.length).total
}

async function main() {
  const input = fullCollegeInput()
  console.log(`full-college: ${input.units.length} юнитов, ${input.teachers.length} преподавателей, ${input.rooms.length} кабинетов, ${input.groups.length} групп`)

  let failed = false

  // ── 1) жадная фаза одна.
  const greedyStart = Date.now()
  const greedyOutput = solveGreedy(input)
  const greedyElapsedMs = Date.now() - greedyStart
  const greedyViolations = validateSolution(input, greedyOutput)
  const greedyPenalty = realPenalty(input, greedyOutput)

  console.log(`\nжадная фаза: ${greedyElapsedMs} мс (лимит ${GREEDY_TIME_BUDGET_MS} мс)`)
  console.log(`размещено: ${greedyOutput.assignments.length} из ${input.units.length} (${greedyOutput.unplaced.length} в unplaced)`)
  console.log(`штраф: ${greedyPenalty}, нарушений валидатора: ${greedyViolations.length}`)

  if (greedyElapsedMs > GREEDY_TIME_BUDGET_MS) {
    console.error(`ПРЕВЫШЕН БЮДЖЕТ ВРЕМЕНИ ЖАДНОЙ ФАЗЫ: ${greedyElapsedMs} мс > ${GREEDY_TIME_BUDGET_MS} мс`)
    failed = true
  }
  if (greedyViolations.length > 0) {
    console.error(`ОБНАРУЖЕНЫ ЖЁСТКИЕ НАРУШЕНИЯ (жадная фаза): ${greedyViolations.length}`)
    for (const v of greedyViolations.slice(0, 10)) console.error(`  юнит #${v.unitId}: ${v.reason} — ${v.detail}`)
    failed = true
  }

  // ── 2) жадная фаза + локальный поиск, тот же вход (§6 «Готово когда»).
  const searchInput: SolverInput = { ...input, limits: { ...input.limits, timeBudgetMs: SEARCH_TIME_BUDGET_MS } }
  const searchStart = Date.now()
  const searchOutput = await solve(searchInput)
  const searchElapsedMs = Date.now() - searchStart
  const searchViolations = validateSolution(input, searchOutput)

  console.log(`\nжадная фаза + локальный поиск: ${searchElapsedMs} мс (бюджет ${SEARCH_TIME_BUDGET_MS} мс), stoppedBy=${searchOutput.stoppedBy}`)
  console.log(`размещено: ${searchOutput.assignments.length} из ${input.units.length} (${searchOutput.unplaced.length} в unplaced)`)
  console.log(`штраф: ${searchOutput.penalty} (было ${greedyPenalty}), нарушений валидатора: ${searchViolations.length}`)

  if (searchViolations.length > 0) {
    console.error(`ОБНАРУЖЕНЫ ЖЁСТКИЕ НАРУШЕНИЯ (после локального поиска): ${searchViolations.length}`)
    for (const v of searchViolations.slice(0, 10)) console.error(`  юнит #${v.unitId}: ${v.reason} — ${v.detail}`)
    failed = true
  }

  if (greedyPenalty > 0) {
    const improvement = (greedyPenalty - searchOutput.penalty) / greedyPenalty
    console.log(`улучшение: ${(improvement * 100).toFixed(1)} % (требуется ≥ ${MIN_IMPROVEMENT * 100} %)`)
    if (improvement < MIN_IMPROVEMENT) {
      console.error(`НЕДОСТАТОЧНОЕ УЛУЧШЕНИЕ: ${(improvement * 100).toFixed(1)} % < ${MIN_IMPROVEMENT * 100} %`)
      failed = true
    }
  } else {
    console.log('штраф жадной фазы уже 0 — порог улучшения неприменим')
  }

  if (failed) process.exit(1)
  console.log('\nOK')
}

void main()
