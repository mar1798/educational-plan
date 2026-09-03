import { solveGreedy } from './greedy'
import type { SolverHooks, SolverInput, SolverOutput } from './model'

/** Единственная точка входа солвера (§3.3, §5.1). Фаза 2 (`localSearch.ts`) добавится в этапе 6. */
export function solve(input: SolverInput, hooks: SolverHooks = {}): SolverOutput {
  return solveGreedy(input, hooks)
}

export * from './model'
