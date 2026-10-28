/**
 * Бенчмарк солвера (§9.1 уровень 5, §10 PLAN.md), два прогона на каждом наборе:
 * 1) жадная фаза (этап 5) одна — должна укладываться в 3 секунды и не давать жёстких нарушений;
 * 2) жадная фаза + локальный поиск (этап 6, бюджет 60 с) — штраф должен упасть минимум
 *    на 40 % относительно жадной фазы при том же бюджете 60 с (обе фазы считают штраф одной
 *    и той же функцией §5.5) — это и есть «Готово когда» этапа 6.
 * Наборы: `full-college` и он же с длинной практикой (п. 48) — без второго порог ничего не
 * говорит о занятиях из нескольких пар подряд.
 * Запуск: `npm run bench:solver`.
 */
import { solve } from '../../src/solver'
import { solveGreedy } from '../../src/solver/greedy'
import { validateSolution } from '../../src/solver/validate'
import { fullCollegeInput, fullCollegeLongSessionsInput } from '../fixtures/solver'
import type { SolverInput } from '../../src/solver/model'

const GREEDY_TIME_BUDGET_MS = 3000
const SEARCH_TIME_BUDGET_MS = 60_000
const MIN_IMPROVEMENT = 0.4

/** Прогоняет обе фазы на наборе; `true` — порог выдержан. */
async function runScenario(name: string, input: SolverInput): Promise<boolean> {
  console.log(`\n═══ ${name}: ${input.units.length} юнитов, ${input.teachers.length} преподавателей, ${input.rooms.length} кабинетов, ${input.groups.length} групп`)

  let ok = true

  // ── 1) жадная фаза одна.
  const greedyStart = Date.now()
  const greedyOutput = solveGreedy(input)
  const greedyElapsedMs = Date.now() - greedyStart
  const greedyViolations = validateSolution(input, greedyOutput)
  const greedyPenalty = greedyOutput.penalty

  console.log(`\nжадная фаза: ${greedyElapsedMs} мс (лимит ${GREEDY_TIME_BUDGET_MS} мс)`)
  console.log(`размещено: ${greedyOutput.assignments.length} из ${input.units.length} (${greedyOutput.unplaced.length} в unplaced)`)
  console.log(`штраф: ${greedyPenalty}, нарушений валидатора: ${greedyViolations.length}`)

  if (greedyElapsedMs > GREEDY_TIME_BUDGET_MS) {
    console.error(`ПРЕВЫШЕН БЮДЖЕТ ВРЕМЕНИ ЖАДНОЙ ФАЗЫ: ${greedyElapsedMs} мс > ${GREEDY_TIME_BUDGET_MS} мс`)
    ok = false
  }
  if (greedyViolations.length > 0) {
    console.error(`ОБНАРУЖЕНЫ ЖЁСТКИЕ НАРУШЕНИЯ (жадная фаза): ${greedyViolations.length}`)
    for (const v of greedyViolations.slice(0, 10)) console.error(`  юнит #${v.unitId}: ${v.reason} — ${v.detail}`)
    ok = false
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
    ok = false
  }

  if (greedyPenalty > 0) {
    const improvement = (greedyPenalty - searchOutput.penalty) / greedyPenalty
    console.log(`улучшение: ${(improvement * 100).toFixed(1)} % (требуется ≥ ${MIN_IMPROVEMENT * 100} %)`)
    if (improvement < MIN_IMPROVEMENT) {
      console.error(`НЕДОСТАТОЧНОЕ УЛУЧШЕНИЕ: ${(improvement * 100).toFixed(1)} % < ${MIN_IMPROVEMENT * 100} %`)
      ok = false
    }
  } else {
    console.log('штраф жадной фазы уже 0 — порог улучшения неприменим')
  }

  return ok
}

async function main() {
  // Оба набора гоняются всегда: провал первого не должен прятать результат второго.
  const results = [
    await runScenario('full-college', fullCollegeInput()),
    await runScenario('full-college, длинная практика', fullCollegeLongSessionsInput()),
  ]
  if (results.includes(false)) process.exit(1)
  console.log('\nOK')
}

void main()
