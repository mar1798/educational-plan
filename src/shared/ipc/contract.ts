export interface OperationSummary {
  id: number
  kind: 'generate' | 'rollout' | 'import' | 'bulk_edit' | 'restore'
  status: 'preview' | 'applied' | 'undone'
  paramsJson: string | null
  summaryJson: string | null
  startedAt: string
  finishedAt: string | null
  createdBy: string
}

export interface ChangeLogEntry {
  id: number
  entity: string
  entityId: number
  action: 'create' | 'update' | 'close'
  beforeJson: string | null
  afterJson: string | null
  at: string
  user: string
  reason: string | null
}

export interface BackupInfo {
  id: number
  fileName: string
  createdAt: string
  reason: 'schedule' | 'pre_migration' | 'manual' | 'pre_restore'
  sizeBytes: number
  schemaVersion: string | null
}

export interface IpcContract {
  'settings:get': { in: { key: string }; out: { value: string | null } }
  'settings:set': { in: { key: string; value: string }; out: { ok: true } }

  // Заготовка utilityProcess (задача 0.7): проверка форк/прогресс/отмена.
  // Будет заменена реальным 'generation:*' в этапе 5 (§3.5).
  'demo:compute:start': { in: { seed: number }; out: { jobId: string } }
  'demo:compute:cancel': { in: { jobId: string }; out: { ok: true } }

  // Операции и аудит (§1.5, §2.10, §3.2) — ядро данных этапа 1, UI появится в этапе 2.
  'operations:list': { in: { kind?: OperationSummary['kind'] }; out: OperationSummary[] }
  'operations:undo': { in: { operationId: number }; out: { ok: true } }
  'audit:entity': { in: { entity: string; id: number }; out: ChangeLogEntry[] }

  // Бэкапы и восстановление (§1.6, §1.7, §1.7a).
  'backup:list': { in: Record<string, never>; out: BackupInfo[] }
  'backup:create': { in: { reason: 'manual' }; out: BackupInfo }
  // Успешный вызов закрывает БД и перезапускает приложение — обычный ответ не возвращается.
  'backup:restore': { in: { fileName: string }; out: { ok: true } }
  'backup:externalCopy': { in: Record<string, never>; out: { copiedTo: string; at: string } | { cancelled: true } }
  'backup:externalStatus': { in: Record<string, never>; out: { lastExternalCopyAt: string | null; isStale: boolean } }
}

export type IpcChannel = keyof IpcContract

export interface IpcEvents {
  'demo:compute:progress': { jobId: string; percent: number; iteration: number }
  'demo:compute:done': { jobId: string; placed: number; penalty: number }
}
