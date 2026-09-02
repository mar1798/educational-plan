import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { auditColumns, id } from './_helpers'
import { speciality } from './org'

export const discipline = sqliteTable('discipline', {
  id: id(),
  name: text('name').notNull(),
  indexCode: text('index_code'),
  block: integer('block').notNull().$type<1 | 2 | 3>(),
  cycle: text('cycle').notNull().$type<'spo1' | 'spo2' | 'spo3' | 'spo4' | 'spo5'>(),
  part: text('part').notNull().$type<'base' | 'elective'>(),
  difficulty: integer('difficulty').notNull().default(1),
  defaultRoomType: text('default_room_type'),
  requiresClinical: integer('requires_clinical', { mode: 'boolean' }).notNull().default(false),
  archivedAt: text('archived_at'),
  ...auditColumns,
})

export const curriculum = sqliteTable('curriculum', {
  id: id(),
  specialityId: integer('speciality_id')
    .notNull()
    .references(() => speciality.id, { onDelete: 'restrict' }),
  admissionYear: integer('admission_year').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft').$type<'draft' | 'approved' | 'archived'>(),
  approvedAt: text('approved_at'),
  approvedBy: text('approved_by'),
  ...auditColumns,
})

export const curriculumRow = sqliteTable('curriculum_row', {
  id: id(),
  curriculumId: integer('curriculum_id')
    .notNull()
    .references(() => curriculum.id, { onDelete: 'restrict' }),
  disciplineId: integer('discipline_id')
    .notNull()
    .references(() => discipline.id, { onDelete: 'restrict' }),
  course: integer('course').notNull(),
  semesterNo: integer('semester_no').notNull(),
  credits: integer('credits').notNull(),
  hoursTotal: integer('hours_total').notNull(),
  hoursClassroom: integer('hours_classroom').notNull(),
  hoursTheory: integer('hours_theory').notNull().default(0),
  hoursPractice: integer('hours_practice').notNull().default(0),
  hoursSeminar: integer('hours_seminar').notNull().default(0),
  hoursLab: integer('hours_lab').notNull().default(0),
  hoursSrs: integer('hours_srs').notNull().default(0),
  controlSemester: integer('control_semester'),
  validFrom: text('valid_from').notNull(),
  validTo: text('valid_to'),
  supersedesId: integer('supersedes_id').references((): AnySQLiteColumn => curriculumRow.id, { onDelete: 'restrict' }),
  ...auditColumns,
})

export const curriculumWeek = sqliteTable(
  'curriculum_week',
  {
    id: id(),
    curriculumRowId: integer('curriculum_row_id')
      .notNull()
      .references(() => curriculumRow.id, { onDelete: 'restrict' }),
    weekNo: integer('week_no').notNull(),
    hours: integer('hours').notNull(),
    ...auditColumns,
  },
  (t) => [uniqueIndex('uq_curriculum_week').on(t.curriculumRowId, t.weekNo)],
)
