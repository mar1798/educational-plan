import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { createDb } from './db/client'
import { runMigrations } from './db/migrate'
import { registerDemoComputeHandlers } from './ipc/demo-compute'
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

  const { db } = createDb(dbPath())
  runMigrations(db, migrationsPath())

  registerSettingsHandlers(db)
  registerDemoComputeHandlers(() => mainWindow)

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
