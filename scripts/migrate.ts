import { createDb } from '../src/main/db/client'
import { runMigrations } from '../src/main/db/migrate'

const dbPath = process.argv[2] ?? './scripts/.dev.db'

const { db, sqlite } = createDb(dbPath)
runMigrations(db, './drizzle')
sqlite.close()

console.log(`Migrated ${dbPath}`)
