export interface SolverInput {
  seed: number
}

export interface SolverProgress {
  percent: number
  iteration: number
}

export interface SolverOutput {
  placed: number
  penalty: number
}

export interface SolverHooks {
  onProgress?: (progress: SolverProgress) => void
  isCancelled?: () => boolean
}
