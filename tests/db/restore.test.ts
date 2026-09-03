/** Регрессия §1.7: имя файла бэкапа приходит из renderer и подставляется в путь. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupsDir } from '../../src/main/db/backup/backup'
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
})
