export interface IpcContract {
  'settings:get': { in: { key: string }; out: { value: string | null } }
  'settings:set': { in: { key: string; value: string }; out: { ok: true } }

  // Заготовка utilityProcess (задача 0.7): проверка форк/прогресс/отмена.
  // Будет заменена реальным 'generation:*' в этапе 5 (§3.5).
  'demo:compute:start': { in: { seed: number }; out: { jobId: string } }
  'demo:compute:cancel': { in: { jobId: string }; out: { ok: true } }
}

export type IpcChannel = keyof IpcContract

export interface IpcEvents {
  'demo:compute:progress': { jobId: string; percent: number; iteration: number }
  'demo:compute:done': { jobId: string; placed: number; penalty: number }
}
