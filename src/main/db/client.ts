import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export function createDb(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true })

  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('synchronous = NORMAL')

  const db = drizzle(sqlite, { schema })

  const version = sqlite.prepare('select sqlite_version() as v').pluck().get() as string
  console.log(`[db] SQLite ${version}, файл: ${dbPath}`)

  return { db, sqlite }
}

export type Db = ReturnType<typeof createDb>['db']
