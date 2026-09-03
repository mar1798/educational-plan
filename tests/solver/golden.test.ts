/**
 * Регрессия качества (§9.1 уровень 4, §10 PLAN.md): «золотые» наборы с зафиксированным seed
 * и порогом штрафа — `expect(penalty).toBeLessThan(GOLDEN + 5%)`. Ловит ухудшение алгоритма
 * при рефакторинге локального поиска или функции штрафа.
 *
 * Бюджет времени намеренно щедрый (30 с), а решающий стоп-критерий — фиксированное число
 * итераций (`maxIterations`): так результат не зависит от скорости машины, на которой
 * запущен тест (в отличие от бенчмарка §9.1 уровень 5 — `npm run bench:solver` — где именно
 * скорость на бюджет времени и проверяется).
 */
import { describe, expect, it } from 'vitest'
import { solve } from '../../src/solver'
import { validateSolution } from '../../src/solver/validate'
import { roomyInput, tightInput } from '../fixtures/solver'
import type { SolverInput } from '../../src/solver/model'

const GOLDEN_SEED = 12345

function golden(input: SolverInput): SolverInput {
  return { ...input, limits: { timeBudgetMs: 30_000, maxIterations: 15_000, seed: GOLDEN_SEED } }
}

describe('golden: регрессия качества локального поиска', () => {
  it('tight: штраф не выше зафиксированного порога', async () => {
    const input = golden(tightInput())
    const GOLDEN_PENALTY = 69
    const output = await solve(input)
    expect(validateSolution(input, output)).toEqual([])
    expect(output.penalty).toBeLessThanOrEqual(Math.ceil(GOLDEN_PENALTY * 1.05))
  })

  it('roomy: щедрые ресурсы — локальный поиск находит решение с нулевым штрафом', async () => {
    const input = golden(roomyInput())
    const output = await solve(input)
    expect(validateSolution(input, output)).toEqual([])
    expect(output.unplaced).toHaveLength(0)
    expect(output.penalty).toBe(0)
  })
})
