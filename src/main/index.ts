import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { createBackup, registerBackup, snapshotDbFile } from './db/backup/backup'
import { createDb } from './db/client'
import { runMigrations } from './db/migrate'
import { registerAuditHandlers } from './ipc/audit'
import { registerBackupHandlers } from './ipc/backup'
import { registerDemoComputeHandlers } from './ipc/demo-compute'
import { registerOperationsHandlers } from './ipc/operations'
import { registerSettingsHandlers } from './ipc/settings'
import { applyContentSecurityPolicy, createMainWindow } from './window'

function migrationsPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(__dirname, '../../drizzle')
}

function dbPath(): string {
  return join(app.getPath('userData'), 'data', 'college.db')
}

let mainWindow: BrowserWindow | null = null

async function bootstrap() {
  await app.whenReady()

  applyContentSecurityPolicy()

  const path = dbPath()
  // Бэкап перед миграцией (§1.6) имеет смысл только для уже существующей БД —
  // на первом запуске файла ещё нет, бэкапировать нечего.
  const isExistingDb = existsSync(path)

  const { db, sqlite } = createDb(path)
  // Файл снимается до миграции, а регистрируется после: до неё таблицы `backup`
  // в старой схеме может ещё не быть (БД этапа 0 знала только app_setting).
  const preMigration = isExistingDb ? snapshotDbFile(sqlite, path, 'pre_migration') : null
  runMigrations(db, migrationsPath())
  if (preMigration) registerBackup(db, path, preMigration)
  // Автокопия при каждом запуске (§1.6, решение №30).
  createBackup(sqlite, db, path, 'schedule')

  registerSettingsHandlers(db)
  registerDemoComputeHandlers(() => mainWindow)
  registerOperationsHandlers(db)
  registerAuditHandlers(db)
  registerBackupHandlers({ sqlite, db, dbPath: path, getWindow: () => mainWindow })

  mainWindow = createMainWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

void bootstrap()
