/**
 * Бенчмарк солвера (§9.1 уровень 5, §10 PLAN.md): жадная фаза на `full-college`
 * должна укладываться в 3 секунды и не давать ни одного жёсткого нарушения.
 * Запуск: `npm run bench:solver`.
 */
import { solveGreedy } from '../../src/solver/greedy'
import { validateSolution } from '../../src/solver/validate'
import { fullCollegeInput } from '../fixtures/solver'

const TIME_BUDGET_MS = 3000

function main() {
  const input = fullCollegeInput()
  console.log(`full-college: ${input.units.length} юнитов, ${input.teachers.length} преподавателей, ${input.rooms.length} кабинетов, ${input.groups.length} групп`)

  const start = Date.now()
  const output = solveGreedy(input)
  const elapsedMs = Date.now() - start

  const violations = validateSolution(input, output)

  console.log(`время: ${elapsedMs} мс (лимит ${TIME_BUDGET_MS} мс)`)
  console.log(`размещено: ${output.assignments.length} из ${input.units.length} (${output.unplaced.length} в unplaced)`)
  console.log(`штраф: ${output.penalty}, нарушений валидатора: ${violations.length}`)

  let failed = false
  if (elapsedMs > TIME_BUDGET_MS) {
    console.error(`ПРЕВЫШЕН БЮДЖЕТ ВРЕМЕНИ: ${elapsedMs} мс > ${TIME_BUDGET_MS} мс`)
    failed = true
  }
  if (violations.length > 0) {
    console.error(`ОБНАРУЖЕНЫ ЖЁСТКИЕ НАРУШЕНИЯ: ${violations.length}`)
    for (const v of violations.slice(0, 10)) console.error(`  юнит #${v.unitId}: ${v.reason} — ${v.detail}`)
    failed = true
  }

  if (failed) process.exit(1)
  console.log('OK')
}

main()
