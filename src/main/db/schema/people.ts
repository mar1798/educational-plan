import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { auditColumns, id } from './_helpers'
import { speciality } from './org'
import { discipline } from './curriculum'
import { semester } from './calendar'

export const teacherCategory = sqliteTable('teacher_category', {
  id: id(),
  code: text('code').notNull().unique().$type<'staff' | 'external' | 'hourly'>(),
  titleRu: text('title_ru').notNull(),
  // Заполнена только у штатных (§4.3): у внештатных/почасовиков нормы нет.
  normHoursYear: integer('norm_hours_year'),
  ...auditColumns,
})

export const teacher = sqliteTable('teacher', {
  id: id(),
  lastName: text('last_name').notNull(),
  firstName: text('first_name').notNull(),
  middleName: text('middle_name'),
  cmcId: integer('cmc_id').references((): AnySQLiteColumn => cmc.id, { onDelete: 'restrict' }),
  categoryId: integer('category_id')
    .notNull()
    .references(() => teacherCategory.id, { onDelete: 'restrict' }),
  rate: real('rate').notNull().default(1),
  maxHoursYear: integer('max_hours_year'),
  maxPairsPerDay: integer('max_pairs_per_day'),
  phone: text('phone'),
  mainWorkplace: text('main_workplace'),
  availabilityNote: text('availability_note'),
  hiredAt: text('hired_at'),
  firedAt: text('fired_at'),
  note: text('note'),
  ...auditColumns,
})

export const cmc = sqliteTable('cmc', {
  id: id(),
  name: text('name').notNull(),
  headTeacherId: integer('head_teacher_id').references(() => teacher.id, { onDelete: 'restrict' }),
  ...auditColumns,
})

export const teacherQualification = sqliteTable(
  'teacher_qualification',
  {
    id: id(),
    teacherId: integer('teacher_id')
      .notNull()
      .references(() => teacher.id, { onDelete: 'restrict' }),
    disciplineId: integer('discipline_id')
      .notNull()
      .references(() => discipline.id, { onDelete: 'restrict' }),
    validFrom: text('valid_from').notNull(),
    validTo: text('valid_to'),
    ...auditColumns,
  },
  (t) => [index('idx_qual_teacher').on(t.teacherId, t.disciplineId, t.validFrom)],
)

export const teacherAbsence = sqliteTable('teacher_absence', {
  id: id(),
  teacherId: integer('teacher_id')
    .notNull()
    .references(() => teacher.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull().$type<'hard' | 'soft'>(),
  scope: text('scope').notNull().$type<'weekday' | 'date_range'>(),
  dayOfWeek: integer('day_of_week'),
  dateFrom: text('date_from'),
  dateTo: text('date_to'),
  pairFrom: integer('pair_from').notNull(),
  pairTo: integer('pair_to').notNull(),
  weight: integer('weight').notNull().default(0),
  reason: text('reason'),
  ...auditColumns,
})

export const studyGroup = sqliteTable('study_group', {
  id: id(),
  name: text('name').notNull(),
  specialityId: integer('speciality_id')
    .notNull()
    .references(() => speciality.id, { onDelete: 'restrict' }),
  admissionYear: integer('admission_year').notNull(),
  course: integer('course').notNull(),
  studentsCount: integer('students_count').notNull(),
  maxPairsPerDay: integer('max_pairs_per_day').notNull().default(6),
  maxHoursPerWeek: integer('max_hours_per_week').notNull().default(45),
  funding: text('funding').notNull().$type<'budget' | 'contract'>(),
  validFrom: text('valid_from').notNull(),
  validTo: text('valid_to'),
  mergedIntoId: integer('merged_into_id').references((): AnySQLiteColumn => studyGroup.id, { onDelete: 'restrict' }),
  ...auditColumns,
})

export const divisionScheme = sqliteTable('division_scheme', {
  id: id(),
  groupId: integer('group_id')
    .notNull()
    .references(() => studyGroup.id, { onDelete: 'restrict' }),
  semesterId: integer('semester_id')
    .notNull()
    .references(() => semester.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  partsCount: integer('parts_count').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  validFrom: text('valid_from').notNull(),
  validTo: text('valid_to'),
  ...auditColumns,
})

export const subgroup = sqliteTable(
  'subgroup',
  {
    id: id(),
    groupId: integer('group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'restrict' }),
    schemeId: integer('scheme_id')
      .notNull()
      .references(() => divisionScheme.id, { onDelete: 'restrict' }),
    no: integer('no').notNull(),
    posFrom: integer('pos_from').notNull(),
    posTo: integer('pos_to').notNull(),
    validFrom: text('valid_from').notNull(),
    validTo: text('valid_to'),
    ...auditColumns,
  },
  (t) => [uniqueIndex('uq_subgroup_scheme_no').on(t.schemeId, t.no)],
)
