import { changeLog } from '../schema/system'
import type { DbLike } from './types'

export type ChangeAction = 'create' | 'update' | 'close' | 'delete'

export interface AuditContext {
  reason?: string
  user?: string
  operationId?: number | null
}

export function nowIso(): string {
  return new Date().toISOString()
}

// §1.4: любое изменение через репозиторий порождает запись в change_log.
export function withAudit(
  tx: DbLike,
  entity: string,
  entityId: number,
  action: ChangeAction,
  before: unknown,
  after: unknown,
  ctx: AuditContext = {},
): void {
  tx.insert(changeLog)
    .values({
      operationId: ctx.operationId ?? null,
      entity,
      entityId,
      action,
      beforeJson: before == null ? null : JSON.stringify(before),
      afterJson: after == null ? null : JSON.stringify(after),
      at: nowIso(),
      user: ctx.user ?? 'admin',
      reason: ctx.reason ?? null,
    })
    .run()
}
