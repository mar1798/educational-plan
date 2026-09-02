import { join } from 'node:path'
import { app, dialog, type BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import type { Db } from '../db/client'
import { backupsDir, createBackup, listBackups } from '../db/backup/backup'
import { getLastExternalCopyAt, isExternalCopyStale, saveExternalCopy } from '../db/backup/external-copy'
import { restoreFromBackup } from '../db/backup/restore'
import {
  backupCreateInput,
  backupExternalCopyInput,
  backupExternalStatusInput,
  backupListInput,
  backupRestoreInput,
} from '../../shared/ipc/schemas'
import { handle } from './register'

export interface BackupDeps {
  sqlite: Database.Database
  db: Db
  dbPath: string
  getWindow: () => BrowserWindow | null
}

export function registerBackupHandlers({ sqlite, db, dbPath, getWindow }: BackupDeps) {
  handle('backup:list', backupListInput, () => listBackups(db))

  handle('backup:create', backupCreateInput, ({ reason }) => createBackup(sqlite, db, dbPath, reason))

  handle('backup:restore', backupRestoreInput, ({ fileName }) => {
    restoreFromBackup(sqlite, db, dbPath, fileName)
    // §1.7: после подмены файла состояние main-процесса (открытые handle'ы БД во всех
    // сервисах) недействительно — перезапускаем приложение целиком.
    app.relaunch()
    app.exit(0)
    return { ok: true as const }
  })

  handle('backup:externalCopy', backupExternalCopyInput, async () => {
    const win = getWindow()
    const dialogOptions = { properties: ['openDirectory' as const], title: 'Папка для копии базы данных' }
    const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true as const }
    }

    const source = createBackup(sqlite, db, dbPath, 'manual')
    return saveExternalCopy(db, join(backupsDir(dbPath), source.fileName), source.fileName, result.filePaths[0]!)
  })

  handle('backup:externalStatus', backupExternalStatusInput, () => {
    const lastExternalCopyAt = getLastExternalCopyAt(db)
    return { lastExternalCopyAt, isStale: isExternalCopyStale(lastExternalCopyAt) }
  })
}
