import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { auditColumns, id } from './_helpers'
import { semester } from './calendar'
import { studyGroup, teacher } from './people'

export const constraintWeight = sqliteTable('constraint_weight', {
  id: id(),
  code: text('code')
    .notNull()
    .$type<
      | 'student_gaps'
      | 'teacher_gaps'
      | 'spread'
      | 'difficulty_early'
      | 'clinical_grouping'
      | 'teacher_preference'
      | 'teacher_days'
      | 'late_pair'
      | 'room_missing'
      | 'clinical_block_start'
    >(),
  weight: integer('weight').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  // NULL = значение по умолчанию для всех семестров.
  semesterId: integer('semester_id').references(() => semester.id, { onDelete: 'restrict' }),
  titleRu: text('title_ru').notNull(),
  descriptionRu: text('description_ru'),
  ...auditColumns,
})

export const operation = sqliteTable('operation', {
  id: id(),
  kind: text('kind').notNull().$type<'generate' | 'rollout' | 'import' | 'bulk_edit' | 'restore'>(),
  paramsJson: text('params_json'),
  summaryJson: text('summary_json'),
  status: text('status').notNull().default('preview').$type<'preview' | 'applied' | 'undone'>(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  createdBy: text('created_by').notNull().default('admin'),
  ...auditColumns,
})

export const operationSnapshot = sqliteTable(
  'operation_snapshot',
  {
    id: id(),
    operationId: integer('operation_id')
      .notNull()
      .references(() => operation.id, { onDelete: 'restrict' }),
    tableName: text('table_name').notNull(),
    rowId: integer('row_id').notNull(),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    ...auditColumns,
  },
  (t) => [index('idx_operation_snapshot_operation').on(t.operationId)],
)

export const changeLog = sqliteTable(
  'change_log',
  {
    id: id(),
    operationId: integer('operation_id').references(() => operation.id, { onDelete: 'restrict' }),
    entity: text('entity').notNull(),
    entityId: integer('entity_id').notNull(),
    action: text('action').notNull().$type<'create' | 'update' | 'close'>(),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    at: text('at').notNull(),
    user: text('user').notNull().default('admin'),
    reason: text('reason'),
  },
  (t) => [index('idx_change_log_entity').on(t.entity, t.entityId)],
)

export const backup = sqliteTable('backup', {
  id: id(),
  fileName: text('file_name').notNull(),
  createdAt: text('created_at').notNull(),
  reason: text('reason').notNull().$type<'schedule' | 'pre_migration' | 'manual' | 'pre_restore'>(),
  sizeBytes: integer('size_bytes').notNull(),
  schemaVersion: text('schema_version'),
})

export const otherLoad = sqliteTable('other_load', {
  id: id(),
  semesterId: integer('semester_id')
    .notNull()
    .references(() => semester.id, { onDelete: 'restrict' }),
  teacherId: integer('teacher_id')
    .notNull()
    .references(() => teacher.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull().$type<'test' | 'method' | 'iga' | 'other'>(),
  hours: integer('hours').notNull(),
  groupId: integer('group_id').references(() => studyGroup.id, { onDelete: 'restrict' }),
  note: text('note'),
  ...auditColumns,
})
