import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import Database from 'better-sqlite3'
import type { Db } from '../client'
import { backupsDir, snapshotDbFile, registerBackup } from './backup'
import type { BackupSnapshot } from './backup'

/**
 * Переносит запись о снимке в *восстановленную* базу. Строка, вставленная в рабочую базу
 * до подмены файла, исчезает вместе с ней, и снимок «состояние до восстановления» пропадает
 * из списка — откатить ошибочный restore становится нечем.
 */
function registerInRestoredDb(dbPath: string, snapshot: BackupSnapshot): void {
  let restored: Database.Database | null = null
  try {
    restored = new Database(dbPath)
    restored
      .prepare('insert into backup (file_name, created_at, reason, size_bytes, schema_version) values (?, ?, ?, ?, ?)')
      .run(snapshot.fileName, snapshot.createdAt, snapshot.reason, snapshot.sizeBytes, snapshot.schemaVersion)
  } catch {
    // В бэкапе старой схемы таблицы `backup` может ещё не быть — сам файл снимка уже лежит
    // в папке backups, и потеря строки не повод завалить восстановление.
  } finally {
    restored?.close()
  }
}

/**
 * §1.7: «закрыть БД → подменить файл → перезапустить». Возвращает управление вызывающему,
 * который обязан сразу перезапустить приложение — sqlite/db из этого модуля после вызова
 * недействительны.
 */
export function restoreFromBackup(sqlite: Database.Database, db: Db, dbPath: string, backupFileName: string): void {
  // Имя приходит из renderer и подставляется в путь: без этой проверки «../../…» увёл бы
  // копирование за пределы папки бэкапов и подменил бы рабочую базу произвольным файлом.
  if (backupFileName !== basename(backupFileName) || backupFileName.startsWith('.')) {
    throw new Error(`Недопустимое имя файла бэкапа: ${backupFileName}`)
  }
  const source = join(backupsDir(dbPath), backupFileName)
  if (!existsSync(source)) {
    throw new Error(`Файл бэкапа не найден: ${backupFileName}`)
  }

  // Бэкап текущего состояния перед восстановлением — на случай, если выбрали не тот файл.
  const preRestore = snapshotDbFile(sqlite, dbPath, 'pre_restore')
  registerBackup(db, dbPath, preRestore)

  // Копирование прямо поверх рабочего файла не атомарно: упади оно на середине (диск полон,
  // файл держит антивирус), рабочая база осталась бы обрезанной, а соединение — закрытым.
  // Пишем рядом и подменяем переименованием, атомарным в пределах файловой системы.
  const staging = `${dbPath}.restore`
  try {
    copyFileSync(source, staging)
  } catch (error) {
    try {
      rmSync(staging, { force: true })
    } catch {
      // мусора могло и не остаться
    }
    throw error
  }

  sqlite.close()
  for (const suffix of ['-wal', '-shm']) {
    try {
      rmSync(`${dbPath}${suffix}`)
    } catch {
      // побочных файлов WAL может не быть
    }
  }
  renameSync(staging, dbPath)

  registerInRestoredDb(dbPath, preRestore)
}
