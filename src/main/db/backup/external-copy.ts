import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { Db } from '../client'
import { appSetting } from '../schema/app-setting'

// §1.7a: дата последней копии на внешний носитель хранится в app_setting, а не в
// отдельной таблице — это разовая метка интерфейса, а не бизнес-сущность с историей.
export const EXTERNAL_COPY_SETTING_KEY = 'backup.lastExternalCopyAt'
export const EXTERNAL_COPY_WARNING_DAYS = 7

export function getLastExternalCopyAt(db: Db): string | null {
  const row = db.select().from(appSetting).where(eq(appSetting.key, EXTERNAL_COPY_SETTING_KEY)).get()
  return row?.value ?? null
}

export function isExternalCopyStale(lastAt: string | null, now: Date = new Date()): boolean {
  if (!lastAt) return true
  const ageMs = now.getTime() - new Date(lastAt).getTime()
  return ageMs > EXTERNAL_COPY_WARNING_DAYS * 24 * 60 * 60 * 1000
}

export function saveExternalCopy(
  db: Db,
  sourceFilePath: string,
  sourceFileName: string,
  targetDir: string,
): { copiedTo: string; at: string } {
  const target = join(targetDir, sourceFileName)
  copyFileSync(sourceFilePath, target)
  const at = new Date().toISOString()
  db.insert(appSetting)
    .values({ key: EXTERNAL_COPY_SETTING_KEY, value: at })
    .onConflictDoUpdate({ target: appSetting.key, set: { value: at } })
    .run()
  return { copiedTo: target, at }
}
