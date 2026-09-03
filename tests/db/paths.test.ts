/**
 * Риск R2 (PLAN.md §8): «путь с кириллицей и пробелами» — у завуча профиль Windows
 * называется по-русски (`C:\Users\Завуч Иванова\AppData\Roaming\Расписание колледжа`),
 * и весь дисковый слой обязан это переживать. Тест воспроизводит такой путь на любой
 * платформе: имя папки берётся из тех же символов, что и в боевом окружении.
 *
 * Проверяется вся цепочка работы с файлами: создание БД, миграции, `VACUUM INTO`-бэкап,
 * копия на «внешний носитель» и восстановление с подменой файла.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backupsDir, createBackup, snapshotDbFile } from '../../src/main/db/backup/backup'
import { saveExternalCopy } from '../../src/main/db/backup/external-copy'
import { restoreFromBackup } from '../../src/main/db/backup/restore'
import { createDb } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import * as schema from '../../src/main/db/schema'

/** Имитация боевого пути: русские буквы, пробелы и вложенность, как у `app.getPath('userData')`. */
const CYRILLIC_SEGMENTS = ['Завуч Иванова', 'Расписание колледжа', 'data']

describe('пути с кириллицей и пробелами (R2)', () => {
  let root: string
  let dbPath: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eduplan-путь '))
    dbPath = join(root, ...CYRILLIC_SEGMENTS, 'college.db')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('БД создаётся, мигрирует и пишет данные по такому пути', () => {
    const { db, sqlite } = createDb(dbPath)
    runMigrations(db, join(__dirname, '../../drizzle'))

    expect(existsSync(dbPath)).toBe(true)
    db.insert(schema.building).values({ name: 'Главный корпус' }).run()
    expect(db.select().from(schema.building).all().map((b) => b.name)).toEqual(['Главный корпус'])

    sqlite.close()
  })

  it('бэкап, внешняя копия и восстановление работают по такому пути', () => {
    const { db, sqlite } = createDb(dbPath)
    runMigrations(db, join(__dirname, '../../drizzle'))
    db.insert(schema.building).values({ name: 'До бэкапа' }).run()

    // VACUUM INTO принимает путь параметром — на Windows он придёт с обратными слэшами.
    const snapshot = createBackup(sqlite, db, dbPath, 'manual')
    expect(snapshot.sizeBytes).toBeGreaterThan(0)
    expect(existsSync(join(backupsDir(dbPath), snapshot.fileName))).toBe(true)
    // Имя файла бэкапа не должно содержать `:` — на Windows такой файл не создать.
    expect(snapshot.fileName).not.toMatch(/[:*?"<>|]/)

    const flash = join(root, 'Флешка завуча')
    mkdirSync(flash, { recursive: true })
    const copy = saveExternalCopy(db, join(backupsDir(dbPath), snapshot.fileName), snapshot.fileName, flash)
    expect(existsSync(copy.copiedTo)).toBe(true)

    db.insert(schema.building).values({ name: 'После бэкапа' }).run()
    restoreFromBackup(sqlite, db, dbPath, snapshot.fileName)

    const reopened = createDb(dbPath)
    expect(reopened.db.select().from(schema.building).all().map((b) => b.name)).toEqual(['До бэкапа'])
    expect(readdirSync(backupsDir(dbPath)).some((f) => f.includes('pre_restore'))).toBe(true)
    reopened.sqlite.close()
  })

  it('снимок снимается и в папку, которой ещё нет (первый запуск)', () => {
    const { db, sqlite } = createDb(dbPath)
    runMigrations(db, join(__dirname, '../../drizzle'))
    rmSync(backupsDir(dbPath), { recursive: true, force: true })

    const snapshot = snapshotDbFile(sqlite, dbPath, 'pre_migration')
    expect(existsSync(join(backupsDir(dbPath), snapshot.fileName))).toBe(true)

    sqlite.close()
  })
})
