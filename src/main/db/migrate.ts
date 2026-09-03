import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { Db } from './client'

export function runMigrations(db: Db, migrationsFolder: string) {
  migrate(db, { migrationsFolder })
}

/**
 * Есть ли непримененные миграции. Нужно на старте (§1.6): бэкап «перед миграцией» имеет смысл
 * только тогда, когда миграция действительно будет, иначе каждый запуск делает лишний полный
 * `VACUUM INTO` рабочей базы (заметная задержка до появления окна) и вытесняет из истории
 * ротации 20 бэкапов половину действительно интересных снимков.
 *
 * Drizzle кладёт в `__drizzle_migrations.created_at` ту же метку `when`, что стоит в журнале,
 * — сравнение по максимуму и отвечает на вопрос.
 */
export function hasPendingMigrations(sqlite: Database.Database, migrationsFolder: string): boolean {
  let entries: { when: number }[]
  try {
    entries = (JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: { when: number }[] }).entries
  } catch {
    // Журнал не прочитался — считаем, что миграции возможны, и снимаем бэкап: лишний снимок
    // безопаснее пропущенного.
    return true
  }
  if (entries.length === 0) return false

  let applied: number
  try {
    const value = sqlite.prepare('select max(created_at) from __drizzle_migrations').pluck().get()
    if (value == null) return true
    applied = Number(value)
  } catch {
    // Таблицы миграций ещё нет — не применена ни одна.
    return true
  }
  return entries.some((e) => e.when > applied)
}
