/**
 * Бенчмарк солвера (§9.1 уровень 5, §10 PLAN.md), два прогона на каждом наборе:
 * 1) жадная фаза (этап 5) одна — должна укладываться в 3 секунды и не давать жёстких нарушений;
 * 2) жадная фаза + локальный поиск (этап 6, бюджет 60 с) — штраф должен упасть минимум
 *    на 40 % относительно жадной фазы при том же бюджете 60 с (обе фазы считают штраф одной
 *    и той же функцией §5.5) — это и есть «Готово когда» этапа 6.
 * Наборы: `full-college`, он же с длинной практикой (п. 48) — без второго порог ничего не
 * говорит о занятиях из нескольких пар подряд — и он же на второй фазе семестра с предпочтительными
 * слотами (вес `phaseStability`, этап Д).
 * Запуск: `npm run bench:solver`.
 */
import { solve } from '../../src/solver'
import { solveGreedy } from '../../src/solver/greedy'
import { validateSolution } from '../../src/solver/validate'
import { fullCollegeInput, fullCollegeLongSessionsInput, fullCollegePhasedInput } from '../fixtures/solver'
import type { SolverInput } from '../../src/solver/model'

const GREEDY_TIME_BUDGET_MS = 3000
const SEARCH_TIME_BUDGET_MS = 60_000
const MIN_IMPROVEMENT = 0.4
// Вторая фаза семестра: половина занятий закреплена весом phaseStability, и поиск не вправе их улучшать,
// поэтому порог ниже (порог 30 % выбран владельцем проекта). Замеры: вес 6 — 35,5 %, вес 3 — 35,8 %
// (сдвинуто 35 занятий из 195), вес 1 — 46,4 %, но сдвигается уже половина занятий.
const MIN_IMPROVEMENT_PHASED = 0.3
// Длинная практика (по 4 и 6 ч подряд): занятие из нескольких пар ходит только целиком, поэтому свободы
// для поиска меньше. Замер: 31,8 % (штраф 409 → 279); порог 30 % выбран по решению владельца проекта.
const MIN_IMPROVEMENT_LONG = 0.3

/** Прогоняет обе фазы на наборе; `true` — порог выдержан. */
async function runScenario(name: string, input: SolverInput, minImprovement = MIN_IMPROVEMENT): Promise<boolean> {
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
    console.log(`улучшение: ${(improvement * 100).toFixed(1)} % (требуется ≥ ${minImprovement * 100} %)`)
    if (improvement < minImprovement) {
      console.error(`НЕДОСТАТОЧНОЕ УЛУЧШЕНИЕ: ${(improvement * 100).toFixed(1)} % < ${minImprovement * 100} %`)
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
    await runScenario('full-college, длинная практика', fullCollegeLongSessionsInput(), MIN_IMPROVEMENT_LONG),
    await runScenario('full-college, вторая фаза семестра (стабильность)', fullCollegePhasedInput(), MIN_IMPROVEMENT_PHASED),
  ]
  if (results.includes(false)) process.exit(1)
  console.log('\nOK')
}

void main()
