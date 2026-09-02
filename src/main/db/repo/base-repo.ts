import { and, eq, getTableColumns, getTableName } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { operationSnapshot } from '../schema/system'
import { nowIso, withAudit, type AuditContext, type ChangeAction } from './audit'
import type { DbLike } from './types'

export class NotFoundError extends Error {
  constructor(entity: string, id: number) {
    super(`Запись ${entity}#${id} не найдена`)
    this.name = 'NotFoundError'
  }
}

export class OptimisticLockError extends Error {
  constructor(entity: string, id: number) {
    super(`Запись ${entity}#${id} была изменена кем-то ещё — обновите данные и повторите`)
    this.name = 'OptimisticLockError'
  }
}

// operation_snapshot пишется только внутри runOperation() (§1.5); вне операции
// ctx.operationId отсутствует и undo для одиночной правки просто недоступен.
function writeSnapshot(
  tx: DbLike,
  ctx: AuditContext,
  tableName: string,
  rowId: number,
  before: unknown,
  after: unknown,
): void {
  if (ctx.operationId == null) return
  tx.insert(operationSnapshot)
    .values({
      operationId: ctx.operationId,
      tableName,
      rowId,
      beforeJson: before == null ? null : JSON.stringify(before),
      afterJson: after == null ? null : JSON.stringify(after),
    })
    .run()
}

/** Создание строки: created_at/updated_at/row_version проставляются автоматически (§4.3). */
export function createRow<T extends Record<string, unknown>>(
  tx: DbLike,
  table: SQLiteTable,
  values: T,
  ctx: AuditContext = {},
): Record<string, unknown> {
  const cols = getTableColumns(table)
  const entity = getTableName(table)
  const at = nowIso()
  const row: Record<string, unknown> = { ...values }
  if ('createdAt' in cols) row.createdAt = at
  if ('updatedAt' in cols) row.updatedAt = at
  if ('rowVersion' in cols) row.rowVersion = 1
  const inserted = tx.insert(table).values(row).returning().get() as Record<string, unknown>
  withAudit(tx, entity, inserted.id as number, 'create', null, inserted, ctx)
  writeSnapshot(tx, ctx, entity, inserted.id as number, null, inserted)
  return inserted
}

/** Правка строки с оптимистичной блокировкой по row_version (§3.6, §1.3). */
export function updateRow<T extends Record<string, unknown>>(
  tx: DbLike,
  table: SQLiteTable,
  id: number,
  patch: T,
  expectedRowVersion: number,
  ctx: AuditContext = {},
  action: ChangeAction = 'update',
): Record<string, unknown> {
  const cols = getTableColumns(table) as Record<string, SQLiteColumn>
  const entity = getTableName(table)
  const before = tx.select().from(table).where(eq(cols.id!, id)).get() as Record<string, unknown> | undefined
  if (!before) throw new NotFoundError(entity, id)

  const at = nowIso()
  const set: Record<string, unknown> = { ...patch }
  if ('updatedAt' in cols) set.updatedAt = at
  if ('rowVersion' in cols) set.rowVersion = (before.rowVersion as number) + 1

  const updated = tx
    .update(table)
    .set(set)
    .where(and(eq(cols.id!, id), eq(cols.rowVersion!, expectedRowVersion)))
    .returning()
    .get() as Record<string, unknown> | undefined

  if (!updated) throw new OptimisticLockError(entity, id)
  withAudit(tx, entity, id, action, before, updated, ctx)
  writeSnapshot(tx, ctx, entity, id, before, updated)
  return updated
}

/** Историчное «удаление»: проставление valid_to вместо DELETE (§4.1). */
export function closeRow(
  tx: DbLike,
  table: SQLiteTable,
  id: number,
  validTo: string,
  expectedRowVersion: number,
  ctx: AuditContext = {},
): Record<string, unknown> {
  // Историчное закрытие пишется в change_log как 'close', а не 'update' (§4.3):
  // «кто и когда убрал запись из обращения» — отдельный вопрос от «кто её правил».
  return updateRow(tx, table, id, { validTo }, expectedRowVersion, ctx, 'close')
}
