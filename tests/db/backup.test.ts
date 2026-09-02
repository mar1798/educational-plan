import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BACKUP_RETENTION,
  backupsDir,
  createBackup,
  listBackups,
  registerBackup,
  snapshotDbFile,
} from '../../src/main/db/backup/backup'
import {
  EXTERNAL_COPY_WARNING_DAYS,
  getLastExternalCopyAt,
  isExternalCopyStale,
  saveExternalCopy,
} from '../../src/main/db/backup/external-copy'
import { restoreFromBackup } from '../../src/main/db/backup/restore'
import { createDb } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import * as schema from '../../src/main/db/schema'

/** Папка миграций, усечённая до первой (схема этапа 0) — для проверки пути обновления. */
function onlyFirstMigration(intoDir: string): string {
  const source = join(__dirname, '../../drizzle')
  const journal = JSON.parse(readFileSync(join(source, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[]
  }
  const first = journal.entries[0]!
  const target = join(intoDir, 'drizzle-0000')
  mkdirSync(join(target, 'meta'), { recursive: true })
  copyFileSync(join(source, `${first.tag}.sql`), join(target, `${first.tag}.sql`))
  writeFileSync(
    join(target, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: [first] }),
  )
  return target
}

describe('бэкапы (§1.6, §1.7, §1.7a)', () => {
  let dir: string
  let dbPath: string
  let ctx: ReturnType<typeof createDb>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eduplan-backup-'))
    dbPath = join(dir, 'college.db')
    ctx = createDb(dbPath)
    runMigrations(ctx.db, join(__dirname, '../../drizzle'))
  })

  afterEach(() => {
    try {
      ctx.sqlite.close()
    } catch {
      // уже закрыта в тесте восстановления
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('создаёт бэкап рядом с БД через VACUUM INTO и пишет запись в таблицу backup', () => {
    ctx.db.insert(schema.building).values({ name: 'Корпус 1' }).run()

    const info = createBackup(ctx.sqlite, ctx.db, dbPath, 'manual')

    expect(existsSync(join(backupsDir(dbPath), info.fileName))).toBe(true)
    expect(info.sizeBytes).toBeGreaterThan(0)
    expect(listBackups(ctx.db)).toHaveLength(1)
  })

  it('ротация: старше 20-го бэкапа удаляются и с диска, и из таблицы', () => {
    for (let i = 0; i < BACKUP_RETENTION + 5; i++) {
      createBackup(ctx.sqlite, ctx.db, dbPath, 'manual')
    }

    const rows = listBackups(ctx.db)
    expect(rows).toHaveLength(BACKUP_RETENTION)

    const filesOnDisk = readdirSync(backupsDir(dbPath))
    expect(filesOnDisk).toHaveLength(BACKUP_RETENTION)
  })

  it('восстановление из бэкапа: создаёт pre_restore бэкап и возвращает старое состояние', () => {
    ctx.db.insert(schema.building).values({ name: 'До бэкапа' }).run()
    const snapshot = createBackup(ctx.sqlite, ctx.db, dbPath, 'manual')

    ctx.db.insert(schema.building).values({ name: 'После бэкапа' }).run()
    expect(ctx.db.select().from(schema.building).all()).toHaveLength(2)

    restoreFromBackup(ctx.sqlite, ctx.db, dbPath, snapshot.fileName)

    // sqlite/db из ctx теперь недействительны — открываем БД заново, как это сделало бы приложение после restart.
    const reopened = createDb(dbPath)
    const buildings = reopened.db.select().from(schema.building).all()
    expect(buildings.map((b) => b.name)).toEqual(['До бэкапа'])

    // pre_restore бэкап сохранился на диске — можно откатить и восстановление.
    const files = readdirSync(backupsDir(dbPath))
    expect(files.some((f) => f.includes('pre_restore'))).toBe(true)

    reopened.sqlite.close()
  })

  it('восстановление из несуществующего файла падает с понятной ошибкой', () => {
    expect(() => restoreFromBackup(ctx.sqlite, ctx.db, dbPath, 'no-such-file.db')).toThrow(/не найден/)
  })

  it('бэкап перед миграцией снимается со схемы, где таблицы backup ещё нет (§1.6)', () => {
    // БД этапа 0: применена только миграция 0000, таблицы `backup` не существует.
    const legacyDir = mkdtempSync(join(tmpdir(), 'eduplan-legacy-'))
    const legacyPath = join(legacyDir, 'college.db')
    const legacy = createDb(legacyPath)
    runMigrations(legacy.db, onlyFirstMigration(legacyDir))
    expect(() => legacy.db.select().from(schema.backup).all()).toThrow(/no such table/)

    const snapshot = snapshotDbFile(legacy.sqlite, legacyPath, 'pre_migration')
    expect(existsSync(join(backupsDir(legacyPath), snapshot.fileName))).toBe(true)

    // Порядок как в bootstrap(): снимок до миграции, регистрация — после.
    runMigrations(legacy.db, join(__dirname, '../../drizzle'))
    const row = registerBackup(legacy.db, legacyPath, snapshot)
    expect(row.reason).toBe('pre_migration')
    expect(listBackups(legacy.db)).toHaveLength(1)

    legacy.sqlite.close()
    rmSync(legacyDir, { recursive: true, force: true })
  })

  it('в записи бэкапа сохраняется версия схемы', () => {
    const info = createBackup(ctx.sqlite, ctx.db, dbPath, 'manual')
    expect(info.schemaVersion).toBeTruthy()
  })

  it('внешняя копия: без сохранений считается устаревшей, после сохранения — нет', () => {
    expect(getLastExternalCopyAt(ctx.db)).toBeNull()
    expect(isExternalCopyStale(getLastExternalCopyAt(ctx.db))).toBe(true)

    const info = createBackup(ctx.sqlite, ctx.db, dbPath, 'manual')
    const externalDir = mkdtempSync(join(tmpdir(), 'eduplan-external-'))
    const result = saveExternalCopy(ctx.db, join(backupsDir(dbPath), info.fileName), info.fileName, externalDir)

    expect(existsSync(result.copiedTo)).toBe(true)
    expect(getLastExternalCopyAt(ctx.db)).toBe(result.at)
    expect(isExternalCopyStale(getLastExternalCopyAt(ctx.db))).toBe(false)

    rmSync(externalDir, { recursive: true, force: true })
  })

  it('внешняя копия устаревает через EXTERNAL_COPY_WARNING_DAYS дней', () => {
    const weekAgo = new Date(Date.now() - (EXTERNAL_COPY_WARNING_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString()
    expect(isExternalCopyStale(weekAgo)).toBe(true)

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    expect(isExternalCopyStale(yesterday)).toBe(false)
  })
})
