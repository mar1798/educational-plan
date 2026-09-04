import { mkdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type Database from 'better-sqlite3'
import { desc, eq } from 'drizzle-orm'
import type { Db } from '../client'
import { backup } from '../schema/system'
import { NotFoundError } from '../repo/base-repo'

export const BACKUP_RETENTION = 20

export type BackupReason = 'schedule' | 'pre_migration' | 'manual' | 'pre_restore'

export interface BackupSnapshot {
  fileName: string
  createdAt: string
  reason: BackupReason
  sizeBytes: number
  schemaVersion: string | null
}

export function backupsDir(dbPath: string): string {
  return join(dirname(dbPath), 'backups')
}

function backupFileName(reason: BackupReason): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `college-${stamp}-${reason}.db`
}

/**
 * Версия схемы = метка последней применённой миграции Drizzle. Нужна при восстановлении:
 * бэкап, снятый до миграции, несёт старую схему, и это должно быть видно в списке.
 */
function schemaVersion(sqlite: Database.Database): string | null {
  try {
    const value = sqlite.prepare('select max(created_at) from __drizzle_migrations').pluck().get()
    return value == null ? null : String(value)
  } catch {
    // таблицы миграций ещё нет — БД только что создана
    return null
  }
}

/**
 * Снимок файла БД через VACUUM INTO (§1.6) **без** записи в таблицу `backup`: не мешает
 * открытой WAL-транзакции и даёт компактный однофайловый бэкап без -wal/-shm спутников.
 * Отдельно от регистрации, потому что бэкап перед миграцией снимается со схемы,
 * в которой таблицы `backup` может ещё не быть.
 */
export function snapshotDbFile(sqlite: Database.Database, dbPath: string, reason: BackupReason): BackupSnapshot {
  const dir = backupsDir(dbPath)
  mkdirSync(dir, { recursive: true })
  const fileName = backupFileName(reason)
  const target = join(dir, fileName)

  sqlite.prepare('VACUUM INTO ?').run(target)

  return {
    fileName,
    createdAt: new Date().toISOString(),
    reason,
    sizeBytes: statSync(target).size,
    schemaVersion: schemaVersion(sqlite),
  }
}

/** Регистрирует ранее снятый файл в таблице `backup` и прореживает старые (§1.6). */
export function registerBackup(db: Db, dbPath: string, snapshot: BackupSnapshot) {
  const row = db.insert(backup).values(snapshot).returning().get()
  rotateBackups(db, backupsDir(dbPath))
  return row
}

export function createBackup(sqlite: Database.Database, db: Db, dbPath: string, reason: BackupReason) {
  return registerBackup(db, dbPath, snapshotDbFile(sqlite, dbPath, reason))
}

/** Оставляет BACKUP_RETENTION последних бэкапов, остальные удаляет — и файл, и запись (§1.6). */
export function rotateBackups(db: Db, dir: string): void {
  // id вторым ключом: два бэкапа одной миллисекунды иначе сортировались бы произвольно.
  const rows = db.select().from(backup).orderBy(desc(backup.createdAt), desc(backup.id)).all()
  for (const row of rows.slice(BACKUP_RETENTION)) {
    try {
      unlinkSync(join(dir, row.fileName))
    } catch {
      // файла может уже не быть на диске — не мешает почистить запись
    }
    db.delete(backup).where(eq(backup.id, row.id)).run()
  }
}

/** Удаление одного бэкапа по имени файла (§1.6): запись и сам файл. */
export function deleteBackup(db: Db, dbPath: string, fileName: string): void {
  const row = db.select().from(backup).where(eq(backup.fileName, fileName)).get()
  if (!row) throw new NotFoundError('backup', 0)
  try {
    unlinkSync(join(backupsDir(dbPath), row.fileName))
  } catch {
    // файла может уже не быть на диске — запись всё равно убираем, иначе список врёт
  }
  db.delete(backup).where(eq(backup.id, row.id)).run()
}

export function listBackups(db: Db) {
  return db.select().from(backup).orderBy(desc(backup.createdAt), desc(backup.id)).all()
}
