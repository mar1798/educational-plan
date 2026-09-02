import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { appSetting } from '../db/schema'
import { settingsGetInput, settingsSetInput } from '../../shared/ipc/schemas'
import { handle } from './register'

export function registerSettingsHandlers(db: Db) {
  handle('settings:get', settingsGetInput, ({ key }) => {
    const row = db.select().from(appSetting).where(eq(appSetting.key, key)).get()
    return { value: row?.value ?? null }
  })

  handle('settings:set', settingsSetInput, ({ key, value }) => {
    db.insert(appSetting)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSetting.key, set: { value } })
      .run()
    return { ok: true as const }
  })
}
