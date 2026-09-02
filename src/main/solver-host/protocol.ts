export type HostToMainMessage =
  | { type: 'progress'; percent: number; iteration: number }
  | { type: 'done'; placed: number; penalty: number }

export type MainToHostMessage = { type: 'start'; seed: number } | { type: 'cancel' }
