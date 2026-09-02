import { desc, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { undoOperation } from '../db/repo/operations'
import { operation } from '../db/schema/system'
import { operationsListInput, operationsUndoInput } from '../../shared/ipc/schemas'
import { handle } from './register'

export function registerOperationsHandlers(db: Db) {
  handle('operations:list', operationsListInput, ({ kind }) => {
    const rows = kind
      ? db.select().from(operation).where(eq(operation.kind, kind)).orderBy(desc(operation.id)).all()
      : db.select().from(operation).orderBy(desc(operation.id)).all()
    return rows
  })

  handle('operations:undo', operationsUndoInput, ({ operationId }) => {
    undoOperation(db, operationId)
    return { ok: true as const }
  })
}
