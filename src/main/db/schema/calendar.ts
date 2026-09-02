import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { auditColumns, id } from './_helpers'
import { speciality } from './org'

export const academicYear = sqliteTable('academic_year', {
  id: id(),
  name: text('name').notNull().unique(),
  startsOn: text('starts_on').notNull(),
  endsOn: text('ends_on').notNull(),
  ...auditColumns,
})

export const semester = sqliteTable('semester', {
  id: id(),
  academicYearId: integer('academic_year_id')
    .notNull()
    .references(() => academicYear.id, { onDelete: 'restrict' }),
  no: integer('no').notNull().$type<1 | 2>(),
  startsOn: text('starts_on').notNull(),
  endsOn: text('ends_on').notNull(),
  weeksCount: integer('weeks_count').notNull().default(18),
  status: text('status').notNull().default('planning').$type<'planning' | 'active' | 'closed'>(),
  ...auditColumns,
})

export const calendarDay = sqliteTable('calendar_day', {
  date: text('date').primaryKey(),
  semesterId: integer('semester_id').references(() => semester.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull().$type<'study' | 'weekend' | 'holiday' | 'vacation' | 'moved_workday'>(),
  movedFromDate: text('moved_from_date'),
  note: text('note'),
  ...auditColumns,
})

export const calendarPeriod = sqliteTable('calendar_period', {
  id: id(),
  kind: text('kind')
    .notNull()
    .$type<'theory' | 'practice' | 'prequal_practice' | 'vacation' | 'session' | 'iga' | 'quarantine'>(),
  course: integer('course'),
  specialityId: integer('speciality_id').references(() => speciality.id, { onDelete: 'restrict' }),
  // NULL = для всех групп; мягкая связь без FK — см. комментарий в room.pinnedTeacherId.
  groupId: integer('group_id'),
  startsOn: text('starts_on').notNull(),
  endsOn: text('ends_on').notNull(),
  note: text('note'),
  ...auditColumns,
})
