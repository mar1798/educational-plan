import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { changeLog } from '../db/schema/system'
import { auditEntityInput } from '../../shared/ipc/schemas'
import { handle } from './register'

export function registerAuditHandlers(db: Db) {
  handle('audit:entity', auditEntityInput, ({ entity, id }) => {
    return db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.entity, entity), eq(changeLog.entityId, id)))
      .orderBy(asc(changeLog.at))
      .all()
  })
}
