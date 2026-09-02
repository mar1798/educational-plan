import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { Db } from '../client'
import { backupsDir, createBackup } from './backup'

/**
 * §1.7: «закрыть БД → подменить файл → перезапустить». Возвращает управление вызывающему,
 * который обязан сразу перезапустить приложение — sqlite/db из этого модуля после вызова
 * недействительны.
 */
export function restoreFromBackup(sqlite: Database.Database, db: Db, dbPath: string, backupFileName: string): void {
  const source = join(backupsDir(dbPath), backupFileName)
  if (!existsSync(source)) {
    throw new Error(`Файл бэкапа не найден: ${backupFileName}`)
  }

  // Бэкап текущего состояния перед восстановлением — на случай, если выбрали не тот файл.
  createBackup(sqlite, db, dbPath, 'pre_restore')

  sqlite.close()
  for (const suffix of ['-wal', '-shm']) {
    try {
      rmSync(`${dbPath}${suffix}`)
    } catch {
      // побочных файлов WAL может не быть
    }
  }
  copyFileSync(source, dbPath)
}
