import type { SolverInput, SolverOutput, SolverProgress } from '../../solver/model'

export type HostToMainMessage =
  | { type: 'progress'; progress: SolverProgress }
  | { type: 'done'; output: SolverOutput }
  /** Синтезируется менеджером, когда процесс умер, не прислав результат (§5.6). */
  | { type: 'error'; message: string }

export type MainToHostMessage = { type: 'start'; input: SolverInput } | { type: 'cancel' }
