import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const appSetting = sqliteTable('app_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
