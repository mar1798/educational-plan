import { sql } from 'drizzle-orm'
import { integer, text } from 'drizzle-orm/sqlite-core'

export const id = () => integer('id').primaryKey({ autoIncrement: true })

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`

// Добавляются к каждой таблице (§3.6, §4.3): основа для аудита и оптимистичных блокировок.
export const auditColumns = {
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
  rowVersion: integer('row_version').notNull().default(1),
}
