import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { auditColumns, id } from './_helpers'

/**
 * Профиль импорта (§3.8d): сохранённое сопоставление колонок под именем, чтобы повторный
 * импорт файла того же вида не требовал настройки заново. Мастер format-agnostic (§1.1 п.5,
 * п.47) — профиль не хранит имя листа или путь к файлу, только то, как читать данные:
 * диапазон, сопоставление колонок с полями целевой сущности, наследование контекста (3.8a),
 * правило распознавания служебных строк (3.8b). Формат самого mappingJson задаёт
 * мастер импорта (renderer/features/import/ImportWizardPage.tsx) — здесь он непрозрачен намеренно,
 * так же как params_json/summary_json у operation.
 */
export const importProfile = sqliteTable('import_profile', {
  id: id(),
  name: text('name').notNull(),
  targetEntity: text('target_entity').notNull().$type<'curriculum' | 'teaching_load' | 'teacher' | 'calendar_period'>(),
  mappingJson: text('mapping_json').notNull(),
  ...auditColumns,
})
