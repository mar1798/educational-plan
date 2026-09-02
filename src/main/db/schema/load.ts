import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { auditColumns, id } from './_helpers'
import { semester } from './calendar'
import { curriculumRow } from './curriculum'
import { divisionScheme, studyGroup, subgroup, teacher } from './people'

export const stream = sqliteTable('stream', {
  id: id(),
  semesterId: integer('semester_id')
    .notNull()
    .references(() => semester.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  validFrom: text('valid_from').notNull(),
  validTo: text('valid_to'),
  ...auditColumns,
})

export const streamMember = sqliteTable(
  'stream_member',
  {
    id: id(),
    streamId: integer('stream_id')
      .notNull()
      .references(() => stream.id, { onDelete: 'restrict' }),
    groupId: integer('group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'restrict' }),
    validFrom: text('valid_from').notNull(),
    validTo: text('valid_to'),
    ...auditColumns,
  },
  (t) => [index('idx_stream_member').on(t.streamId, t.groupId)],
)

export const teachingLoad = sqliteTable(
  'teaching_load',
  {
    id: id(),
    semesterId: integer('semester_id')
      .notNull()
      .references(() => semester.id, { onDelete: 'restrict' }),
    curriculumRowId: integer('curriculum_row_id')
      .notNull()
      .references(() => curriculumRow.id, { onDelete: 'restrict' }),
    teacherId: integer('teacher_id')
      .notNull()
      .references(() => teacher.id, { onDelete: 'restrict' }),
    // Задано ровно одно из двух (§4.3) — проверяется в сервисе, не выразимо декларативным CHECK
    // без потери читаемости на нескольких колонках сразу.
    groupId: integer('group_id').references(() => studyGroup.id, { onDelete: 'restrict' }),
    streamId: integer('stream_id').references(() => stream.id, { onDelete: 'restrict' }),
    divisionSchemeId: integer('division_scheme_id').references(() => divisionScheme.id, { onDelete: 'restrict' }),
    subgroupId: integer('subgroup_id').references(() => subgroup.id, { onDelete: 'restrict' }),
    lessonKind: text('lesson_kind').notNull().$type<'theory' | 'practice' | 'seminar' | 'lab'>(),
    hoursPlanned: integer('hours_planned').notNull(),
    requiresParallel: integer('requires_parallel', { mode: 'boolean' }).notNull().default(false),
    pairedLoadId: integer('paired_load_id').references((): AnySQLiteColumn => teachingLoad.id, { onDelete: 'restrict' }),
    roomTypeRequired: text('room_type_required'),
    roomIdFixed: integer('room_id_fixed'),
    buildingIdRequired: integer('building_id_required'),
    clinicalModeOverride: text('clinical_mode_override').$type<'full_day' | 'block' | 'free'>(),
    validFrom: text('valid_from').notNull(),
    validTo: text('valid_to'),
    note: text('note'),
    ...auditColumns,
  },
  (t) => [index('idx_load_semester').on(t.semesterId, t.teacherId)],
)
