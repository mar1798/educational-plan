import { sql } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { auditColumns, id } from './_helpers'
import { semester } from './calendar'
import { discipline } from './curriculum'
import { teachingLoad } from './load'
import { operation } from './system'
import { room } from './org'
import { studyGroup, subgroup, teacher } from './people'

export const scheduleTemplate = sqliteTable('schedule_template', {
  id: id(),
  semesterId: integer('semester_id')
    .notNull()
    .references(() => semester.id, { onDelete: 'restrict' }),
  versionNo: integer('version_no').notNull(),
  effectiveFrom: text('effective_from').notNull(),
  effectiveTo: text('effective_to'),
  status: text('status').notNull().default('draft').$type<'draft' | 'active' | 'archived'>(),
  basedOnId: integer('based_on_id').references((): AnySQLiteColumn => scheduleTemplate.id, { onDelete: 'restrict' }),
  note: text('note'),
  createdBy: text('created_by').notNull().default('admin'),
  ...auditColumns,
})

export const templateEntry = sqliteTable(
  'template_entry',
  {
    id: id(),
    templateId: integer('template_id')
      .notNull()
      .references(() => scheduleTemplate.id, { onDelete: 'restrict' }),
    dayOfWeek: integer('day_of_week').notNull(),
    pairNo: integer('pair_no').notNull(),
    teachingLoadId: integer('teaching_load_id')
      .notNull()
      .references(() => teachingLoad.id, { onDelete: 'restrict' }),
    roomId: integer('room_id').references(() => room.id, { onDelete: 'restrict' }),
    weekParity: text('week_parity').notNull().default('all').$type<'all' | 'odd' | 'even'>(),
    isLocked: integer('is_locked', { mode: 'boolean' }).notNull().default(false),
    source: text('source').notNull().$type<'solver' | 'manual'>(),
    ...auditColumns,
  },
  (t) => [index('idx_template_entry_slot').on(t.templateId, t.dayOfWeek, t.pairNo)],
)

export const lesson = sqliteTable(
  'lesson',
  {
    id: id(),
    date: text('date').notNull(),
    pairNo: integer('pair_no').notNull(),
    teachingLoadId: integer('teaching_load_id')
      .notNull()
      .references(() => teachingLoad.id, { onDelete: 'restrict' }),
    teacherId: integer('teacher_id')
      .notNull()
      .references(() => teacher.id, { onDelete: 'restrict' }),
    roomId: integer('room_id').references(() => room.id, { onDelete: 'restrict' }),
    disciplineId: integer('discipline_id')
      .notNull()
      .references(() => discipline.id, { onDelete: 'restrict' }),
    lessonKind: text('lesson_kind').notNull().$type<'theory' | 'practice' | 'seminar' | 'lab'>(),
    academicHours: integer('academic_hours').notNull().default(2),
    templateEntryId: integer('template_entry_id').references(() => templateEntry.id, { onDelete: 'restrict' }),
    templateId: integer('template_id').references(() => scheduleTemplate.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('planned').$type<'planned' | 'held' | 'cancelled' | 'moved'>(),
    movedToLessonId: integer('moved_to_lesson_id').references((): AnySQLiteColumn => lesson.id, { onDelete: 'restrict' }),
    operationId: integer('operation_id')
      .notNull()
      .references(() => operation.id, { onDelete: 'restrict' }),
    note: text('note'),
    ...auditColumns,
  },
  (t) => [
    index('idx_lesson_date_pair').on(t.date, t.pairNo),
    index('idx_lesson_teacher_date').on(t.teacherId, t.date, t.pairNo),
    index('idx_lesson_room_date').on(t.roomId, t.date, t.pairNo),
    index('idx_lesson_load').on(t.teachingLoadId),
    // Жёсткие ограничения, гарантированные СУБД (§4.4): дешёвая страховка от программной
    // ошибки поверх проверки в сервисе (там же обрабатывается пересечение подгрупп).
    uniqueIndex('uq_lesson_teacher')
      .on(t.teacherId, t.date, t.pairNo)
      .where(sql`${t.status} in ('planned','held')`),
    uniqueIndex('uq_lesson_room')
      .on(t.roomId, t.date, t.pairNo)
      .where(sql`${t.status} in ('planned','held') and ${t.roomId} is not null`),
  ],
)

export const lessonGroup = sqliteTable(
  'lesson_group',
  {
    id: id(),
    lessonId: integer('lesson_id')
      .notNull()
      .references(() => lesson.id, { onDelete: 'restrict' }),
    groupId: integer('group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'restrict' }),
    subgroupId: integer('subgroup_id').references(() => subgroup.id, { onDelete: 'restrict' }),
    posFrom: integer('pos_from').notNull(),
    posTo: integer('pos_to').notNull(),
    ...auditColumns,
  },
  (t) => [index('idx_lg_group').on(t.groupId, t.lessonId), index('idx_lg_lesson').on(t.lessonId)],
)

export const substitution = sqliteTable('substitution', {
  id: id(),
  lessonId: integer('lesson_id')
    .notNull()
    .references(() => lesson.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull().$type<'teacher_swap' | 'room_swap' | 'cancel' | 'move'>(),
  originalTeacherId: integer('original_teacher_id')
    .notNull()
    .references(() => teacher.id, { onDelete: 'restrict' }),
  substituteTeacherId: integer('substitute_teacher_id').references(() => teacher.id, { onDelete: 'restrict' }),
  originalRoomId: integer('original_room_id').references(() => room.id, { onDelete: 'restrict' }),
  newRoomId: integer('new_room_id').references(() => room.id, { onDelete: 'restrict' }),
  reason: text('reason'),
  documentNo: text('document_no'),
  createdBy: text('created_by').notNull().default('admin'),
  ...auditColumns,
})
