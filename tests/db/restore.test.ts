/** Регрессия §1.7: имя файла бэкапа приходит из renderer и подставляется в путь. */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { backupsDir, createBackup } from '../../src/main/db/backup/backup'
import { restoreFromBackup } from '../../src/main/db/backup/restore'
import { createTestDb } from './helpers'

describe('восстановление из бэкапа', () => {
  it('отвергает имя, уводящее за пределы папки бэкапов', () => {
    const { db, sqlite, dbPath, dir } = createTestDb()
    const outside = join(dir, 'чужой.db')
    writeFileSync(outside, 'не база')

    expect(() => restoreFromBackup(sqlite, db, dbPath, '../чужой.db')).toThrow(/Недопустимое имя/)
    // Рабочая база не тронута и не закрыта.
    expect(() => sqlite.prepare('select 1').get()).not.toThrow()
  })

  it('несуществующее имя внутри папки — обычная ошибка «не найден»', () => {
    const { db, sqlite, dbPath } = createTestDb()
    expect(backupsDir(dbPath)).toContain('backups')
    expect(() => restoreFromBackup(sqlite, db, dbPath, 'нет-такого.db')).toThrow(/не найден/)
  })

  // Строка pre_restore, вставленная в рабочую базу, исчезает вместе с ней при подмене файла:
  // без переноса в восстановленную базу откатить ошибочное восстановление нечем.
  it('снимок pre_restore виден в списке уже ПОСЛЕ восстановления', () => {
    const { db, sqlite, dbPath } = createTestDb()
    const source = createBackup(sqlite, db, dbPath, 'manual')

    restoreFromBackup(sqlite, db, dbPath, source.fileName)
    expect(existsSync(`${dbPath}.restore`)).toBe(false)

    const restored = new Database(dbPath)
    try {
      const rows = restored.prepare("select file_name, reason from backup where reason = 'pre_restore'").all() as {
        file_name: string
      }[]
      expect(rows).toHaveLength(1)
      expect(existsSync(join(backupsDir(dbPath), rows[0]!.file_name))).toBe(true)
    } finally {
      restored.close()
    }
  })
})
