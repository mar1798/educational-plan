import { desc, eq, getTableColumns } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { changeLog, operation, operationSnapshot } from '../schema/system'
import { resolveTable } from './registry'
import { nowIso } from './audit'
import type { DbLike } from './types'
import type { Db } from '../client'

export type OperationKind = 'generate' | 'rollout' | 'import' | 'bulk_edit' | 'restore'

export class OperationNotUndoableError extends Error {
  constructor(operationId: number, status: string) {
    super(`Операцию #${operationId} нельзя отменить: статус «${status}»`)
    this.name = 'OperationNotUndoableError'
  }
}

/**
 * Выполняет fn в транзакции как единую операцию (§1.5, §3.5 п.7): любые createRow/updateRow
 * внутри fn, получившие ctx.operationId, автоматически копятся в operation_snapshot и
 * становятся материалом для undo().
 */
export function runOperation<T>(
  db: Db,
  kind: OperationKind,
  params: unknown,
  fn: (tx: DbLike, operationId: number) => T,
  opts: { user?: string } = {},
): { operationId: number; result: T } {
  return db.transaction((tx) => {
    const startedAt = nowIso()
    const op = tx
      .insert(operation)
      .values({
        kind,
        paramsJson: JSON.stringify(params),
        status: 'applied',
        startedAt,
        createdBy: opts.user ?? 'admin',
      })
      .returning()
      .get()

    const result = fn(tx, op.id)

    tx.update(operation)
      .set({ finishedAt: nowIso(), summaryJson: JSON.stringify({ ok: true }) })
      .where(eq(operation.id, op.id))
      .run()

    return { operationId: op.id, result }
  })
}

/** Откат операции построчно из operation_snapshot, в обратном порядке записи (§1.5). */
export function undoOperation(db: Db, operationId: number): void {
  db.transaction((tx) => {
    const op = tx.select().from(operation).where(eq(operation.id, operationId)).get()
    if (!op) throw new Error(`Операция #${operationId} не найдена`)
    if (op.status !== 'applied') throw new OperationNotUndoableError(operationId, op.status)

    const snapshots = tx
      .select()
      .from(operationSnapshot)
      .where(eq(operationSnapshot.operationId, operationId))
      .orderBy(desc(operationSnapshot.id))
      .all()

    for (const snap of snapshots) {
      const table = resolveTable(snap.tableName)
      const cols = getTableColumns(table) as Record<string, SQLiteColumn>
      if (snap.beforeJson == null) {
        // Строка была создана этой операцией — откат её физически удаляет:
        // ничто вне этой же операции не могло успеть на неё сослаться.
        tx.delete(table).where(eq(cols.id!, snap.rowId)).run()
      } else if (snap.afterJson == null) {
        // Строка была физически удалена этой операцией (deleteRow, §2.2) — откат
        // вставляет её обратно с тем же id и прежними значениями.
        tx.insert(table).values(JSON.parse(snap.beforeJson)).run()
      } else {
        const before = JSON.parse(snap.beforeJson) as Record<string, unknown>
        tx.update(table).set(before).where(eq(cols.id!, snap.rowId)).run()
      }
    }

    tx.update(operation).set({ status: 'undone', finishedAt: nowIso() }).where(eq(operation.id, operationId)).run()

    tx.insert(changeLog)
      .values({
        operationId,
        entity: 'operation',
        entityId: operationId,
        action: 'update',
        beforeJson: JSON.stringify({ status: 'applied' }),
        afterJson: JSON.stringify({ status: 'undone' }),
        at: nowIso(),
        user: 'admin',
        reason: 'undo',
      })
      .run()
  })
}
