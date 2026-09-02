import { eq, sql } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { DbLike } from './types'

export class ReferencedError extends Error {
  constructor(entityLabel: string, count: number, nounRu: string) {
    super(`Нельзя удалить ${entityLabel}: используется в ${count} ${nounRu}`)
    this.name = 'ReferencedError'
  }
}

export interface ReferenceCheck {
  table: SQLiteTable
  column: SQLiteColumn
  nounRu: string
}

/**
 * Физическое удаление блокируется, если на строку есть ссылки (§2.2): проверяем
 * count(*) по каждой из них до DELETE, чтобы дать точное число в сообщении вместо
 * разбора текста ошибки FOREIGN KEY constraint от SQLite.
 */
export function ensureDeletable(tx: DbLike, entityLabel: string, id: number, refs: ReferenceCheck[]): void {
  for (const ref of refs) {
    const row = tx
      .select({ n: sql<number>`count(*)` })
      .from(ref.table)
      .where(eq(ref.column, id))
      .get() as { n: number }
    if (row.n > 0) throw new ReferencedError(entityLabel, row.n, ref.nounRu)
  }
}
