import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { auditColumns, id } from './_helpers'

export const speciality = sqliteTable('speciality', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  qualification: text('qualification'),
  semestersTotal: integer('semesters_total').notNull().default(6),
  archivedAt: text('archived_at'),
  ...auditColumns,
})

export const building = sqliteTable('building', {
  id: id(),
  name: text('name').notNull(),
  address: text('address'),
  isClinical: integer('is_clinical', { mode: 'boolean' }).notNull().default(false),
  clinicalMode: text('clinical_mode').$type<'full_day' | 'block' | 'free'>(),
  ...auditColumns,
})

export const room = sqliteTable('room', {
  id: id(),
  buildingId: integer('building_id')
    .notNull()
    .references(() => building.id, { onDelete: 'restrict' }),
  number: text('number').notNull(),
  name: text('name'),
  capacity: integer('capacity'),
  roomType: text('room_type')
    .notNull()
    .$type<'lecture' | 'practice' | 'seminar' | 'lab' | 'phantom' | 'computer' | 'gym'>(),
  // Мягкая связь: закрепление кабинета за преподавателем — не FK-инвариант домена,
  // проверяется на уровне сервиса, чтобы не создавать цикл org.ts <-> people.ts.
  pinnedTeacherId: integer('pinned_teacher_id'),
  validFrom: text('valid_from').notNull(),
  validTo: text('valid_to'),
  ...auditColumns,
})

export const pairGrid = sqliteTable('pair_grid', {
  pairNo: integer('pair_no').primaryKey(),
  startsAt: text('starts_at').notNull(),
  endsAt: text('ends_at').notNull(),
  academicHours: integer('academic_hours').notNull().default(2),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  ...auditColumns,
})
