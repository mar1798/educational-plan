import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { createBackup, registerBackup, snapshotDbFile } from './db/backup/backup'
import { createDb } from './db/client'
import { hasPendingMigrations, runMigrations } from './db/migrate'
import { ensureConstraintWeights } from './db/repo/constraint-weights'
import { ensurePairGrid } from './db/repo/pair-grid'
import { ensureTeacherCategories } from './db/repo/seed'
import { registerAcademicYearsHandlers } from './ipc/academic-years'
import { registerAuditHandlers } from './ipc/audit'
import { registerBackupHandlers } from './ipc/backup'
import { registerBuildingsHandlers } from './ipc/buildings'
import { registerCalendarDaysHandlers } from './ipc/calendar-days'
import { registerCalendarPeriodsHandlers } from './ipc/calendar-periods'
import { registerCmcHandlers } from './ipc/cmc'
import { registerConstraintWeightsHandlers } from './ipc/constraint-weights'
import { registerCurriculumHandlers } from './ipc/curriculum'
import { registerDisciplinesHandlers } from './ipc/disciplines'
import { registerExportHandlers } from './ipc/export'
import { registerDivisionSchemesHandlers } from './ipc/division-schemes'
import { registerGenerationHandlers } from './ipc/generation'
import { registerGroupsHandlers } from './ipc/groups'
import { registerImportHandlers } from './ipc/import'
import { registerOperationsHandlers } from './ipc/operations'
import { registerPairGridHandlers } from './ipc/pair-grid'
import { registerReportsHandlers } from './ipc/reports'
import { registerSemestersHandlers } from './ipc/semesters'
import { registerRoomsHandlers } from './ipc/rooms'
import { registerScheduleTemplateHandlers } from './ipc/schedule-template'
import { registerSettingsHandlers } from './ipc/settings'
import { registerSpecialitiesHandlers } from './ipc/specialities'
import { registerSubstitutionsHandlers } from './ipc/substitutions'
import { registerTeacherAbsencesHandlers } from './ipc/teacher-absences'
import { registerTeacherCategoriesHandlers } from './ipc/teacher-categories'
import { registerTeacherQualificationsHandlers } from './ipc/teacher-qualifications'
import { registerTeachersHandlers } from './ipc/teachers'
import { registerTeachingLoadHandlers } from './ipc/teaching-load'
import { applyContentSecurityPolicy, createMainWindow } from './window'

function migrationsPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(__dirname, '../../drizzle')
}

function dbPath(): string {
  return join(app.getPath('userData'), 'data', 'college.db')
}

let mainWindow: BrowserWindow | null = null

/**
 * Единственная точка создания окна: обработчик 'closed' обязан висеть на КАЖДОМ окне.
 * Раньше его вешали только на первое, и после закрытия окна, пересозданного по 'activate'
 * (macOS), `mainWindow` продолжал указывать на уничтоженный BrowserWindow — фоновая
 * отправка 'generation:progress'/'done' роняла main-процесс.
 */
function openMainWindow(): BrowserWindow {
  const win = createMainWindow()
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  return win
}

/** Окно, в которое ещё можно слать сообщения: уничтоженное не годится. */
function liveWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return null
  return mainWindow
}

function reportFatal(error: unknown): void {
  const message = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error)
  dialog.showErrorBox('Не удалось запустить приложение', message)
}

async function bootstrap() {
  // Два экземпляра работают с одним файлом БД: оба прогоняют миграции, оба снимают
  // автобэкап при старте и вытесняют друг у друга снимки из ротации, а записи расходятся
  // между двумя открытыми соединениями. Второй запуск отдаёт фокус первому и выходит.
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  await app.whenReady()

  applyContentSecurityPolicy()

  const path = dbPath()
  // Бэкап перед миграцией (§1.6) имеет смысл только для уже существующей БД —
  // на первом запуске файла ещё нет, бэкапировать нечего.
  const isExistingDb = existsSync(path)

  const { db, sqlite } = createDb(path)
  // Файл снимается до миграции, а регистрируется после: до неё таблицы `backup`
  // в старой схеме может ещё не быть (БД этапа 0 знала только app_setting).
  const preMigration = isExistingDb && hasPendingMigrations(sqlite, migrationsPath()) ? snapshotDbFile(sqlite, path, 'pre_migration') : null
  runMigrations(db, migrationsPath())
  if (preMigration) registerBackup(db, path, preMigration)
  // Автокопия при каждом запуске (§1.6, решение №30).
  createBackup(sqlite, db, path, 'schedule')
  ensureTeacherCategories(db)
  ensurePairGrid(db)
  ensureConstraintWeights(db)

  registerSettingsHandlers(db)
  registerOperationsHandlers(db)
  registerAuditHandlers(db)
  registerBackupHandlers({ sqlite, db, dbPath: path, getWindow: liveWindow })
  registerSpecialitiesHandlers(db)
  registerCmcHandlers(db)
  registerBuildingsHandlers(db)
  registerRoomsHandlers(db)
  registerDisciplinesHandlers(db)
  registerTeacherCategoriesHandlers(db)
  registerTeachersHandlers(db)
  registerTeacherQualificationsHandlers(db)
  registerTeacherAbsencesHandlers(db)
  registerGroupsHandlers(db)
  registerAcademicYearsHandlers(db)
  registerSemestersHandlers(db)
  registerDivisionSchemesHandlers(db)
  registerCalendarDaysHandlers(db)
  registerCalendarPeriodsHandlers(db)
  registerPairGridHandlers(db)
  registerConstraintWeightsHandlers(db)
  registerCurriculumHandlers(db)
  registerTeachingLoadHandlers(db)
  registerScheduleTemplateHandlers(db)
  registerGenerationHandlers(db, liveWindow)
  registerExportHandlers(db, liveWindow)
  registerImportHandlers({ db, getWindow: liveWindow })
  registerSubstitutionsHandlers(db)
  registerReportsHandlers(db)

  mainWindow = openMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = openMainWindow()
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Без этого блока любая ошибка старта (битая БД, упавшая миграция, занятый файл) оставляла
// невидимый процесс Electron без окна и без единого сообщения — пользователь видел, что
// «приложение не запускается», и снимал процесс через диспетчер задач.
process.on('uncaughtException', (error) => {
  reportFatal(error)
  app.exit(1)
})
process.on('unhandledRejection', (reason) => {
  reportFatal(reason)
  app.exit(1)
})

bootstrap().catch((error: unknown) => {
  reportFatal(error)
  app.exit(1)
})
