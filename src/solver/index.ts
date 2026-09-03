import { solveGreedy } from './greedy'
import { runLocalSearch } from './localSearch'
import type { SolverHooks, SolverInput, SolverOutput } from './model'

/**
 * Единственная точка входа солвера (§3.3, §5.1): жадная расстановка (этап 5), затем локальный
 * поиск (этап 6, §5.6 фаза 2) поверх её результата в оставшийся бюджет времени. Асинхронна из-за
 * `runLocalSearch` — она периодически отдаёт event loop, иначе отмена генерации не работала бы
 * во время поиска (см. шапку `localSearch.ts`).
 */
export async function solve(input: SolverInput, hooks: SolverHooks = {}): Promise<SolverOutput> {
  const startedAt = Date.now()
  const greedyOutput = solveGreedy(input, hooks)
  if (hooks.isCancelled?.()) return greedyOutput
  return runLocalSearch(input, greedyOutput, hooks, startedAt)
}

export * from './model'
