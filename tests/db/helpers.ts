import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDb, type Db } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import * as schema from '../../src/main/db/schema'

export function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eduplan-test-'))
  const dbPath = join(dir, 'test.db')
  const { db, sqlite } = createDb(dbPath)
  runMigrations(db, join(__dirname, '../../drizzle'))
  return { db, sqlite, dbPath, dir }
}

export interface MinimalWorld {
  teacherCategoryId: number
  teacherId: number
  teacherId2: number
  buildingId: number
  roomId: number
  roomId2: number
  specialityId: number
  disciplineId: number
  curriculumId: number
  curriculumRowId: number
  academicYearId: number
  semesterId: number
  groupId: number
  teachingLoadId: number
  operationId: number
}

/** Минимальный связный набор данных, достаточный для вставки lesson/teaching_load в тестах. */
export function seedMinimalWorld(db: Db): MinimalWorld {
  const teacherCategoryId = db
    .insert(schema.teacherCategory)
    .values({ code: 'staff', titleRu: 'Штат', normHoursYear: 720 })
    .returning({ id: schema.teacherCategory.id })
    .get().id

  const teacherId = db
    .insert(schema.teacher)
    .values({ lastName: 'Иванова', firstName: 'Т', categoryId: teacherCategoryId })
    .returning({ id: schema.teacher.id })
    .get().id

  const teacherId2 = db
    .insert(schema.teacher)
    .values({ lastName: 'Петров', firstName: 'С', categoryId: teacherCategoryId })
    .returning({ id: schema.teacher.id })
    .get().id

  const buildingId = db
    .insert(schema.building)
    .values({ name: 'Главный корпус' })
    .returning({ id: schema.building.id })
    .get().id

  const roomId = db
    .insert(schema.room)
    .values({ buildingId, number: '204', roomType: 'practice', validFrom: '2026-01-01' })
    .returning({ id: schema.room.id })
    .get().id

  const roomId2 = db
    .insert(schema.room)
    .values({ buildingId, number: '205', roomType: 'practice', validFrom: '2026-01-01' })
    .returning({ id: schema.room.id })
    .get().id

  const specialityId = db
    .insert(schema.speciality)
    .values({ code: 'СД', name: 'Сестринское дело' })
    .returning({ id: schema.speciality.id })
    .get().id

  const disciplineId = db
    .insert(schema.discipline)
    .values({ name: 'Анатомия', block: 1, cycle: 'spo3', part: 'base' })
    .returning({ id: schema.discipline.id })
    .get().id

  const curriculumId = db
    .insert(schema.curriculum)
    .values({ specialityId, admissionYear: 2026, name: 'СД 2026' })
    .returning({ id: schema.curriculum.id })
    .get().id

  const curriculumRowId = db
    .insert(schema.curriculumRow)
    .values({
      curriculumId,
      disciplineId,
      course: 1,
      semesterNo: 1,
      credits: 4,
      hoursTotal: 120,
      hoursClassroom: 80,
      validFrom: '2026-01-01',
    })
    .returning({ id: schema.curriculumRow.id })
    .get().id

  const academicYearId = db
    .insert(schema.academicYear)
    .values({ name: '2026/2027', startsOn: '2026-09-01', endsOn: '2027-06-30' })
    .returning({ id: schema.academicYear.id })
    .get().id

  const semesterId = db
    .insert(schema.semester)
    .values({ academicYearId, no: 1, startsOn: '2026-09-01', endsOn: '2027-01-15' })
    .returning({ id: schema.semester.id })
    .get().id

  const groupId = db
    .insert(schema.studyGroup)
    .values({
      name: '11 СД',
      specialityId,
      admissionYear: 2026,
      course: 1,
      studentsCount: 25,
      funding: 'budget',
      validFrom: '2026-01-01',
    })
    .returning({ id: schema.studyGroup.id })
    .get().id

  const teachingLoadId = db
    .insert(schema.teachingLoad)
    .values({
      semesterId,
      curriculumRowId,
      teacherId,
      groupId,
      lessonKind: 'theory',
      hoursPlanned: 80,
      validFrom: '2026-01-01',
    })
    .returning({ id: schema.teachingLoad.id })
    .get().id

  const operationId = db
    .insert(schema.operation)
    .values({ kind: 'import', status: 'applied', startedAt: new Date().toISOString() })
    .returning({ id: schema.operation.id })
    .get().id

  return {
    teacherCategoryId,
    teacherId,
    teacherId2,
    buildingId,
    roomId,
    roomId2,
    specialityId,
    disciplineId,
    curriculumId,
    curriculumRowId,
    academicYearId,
    semesterId,
    groupId,
    teachingLoadId,
    operationId,
  }
}

/**
 * Демо-колледж масштаба настоящего (§9.2 `full-college`): 39 групп, 140 преподавателей,
 * 55 кабинетов и по 10 недельных строк нагрузки на группу. Нужен там, где важен не смысл
 * данных, а объём — например, приёмка §5.5 «снимок собирается за < 1 с».
 */
export function seedCollegeWorld(db: Db, world: MinimalWorld): { loadIds: number[] } {
  const teacherIds: number[] = []
  for (let i = 0; i < 140; i++) {
    teacherIds.push(
      db
        .insert(schema.teacher)
        .values({ lastName: `Преподаватель${i}`, firstName: 'И', categoryId: world.teacherCategoryId, maxPairsPerDay: 6 })
        .returning({ id: schema.teacher.id })
        .get().id,
    )
  }

  const roomTypes = ['practice', 'lecture', 'lab', 'seminar', 'computer'] as const
  for (let i = 0; i < 55; i++) {
    db.insert(schema.room)
      .values({ buildingId: world.buildingId, number: `к${i}`, roomType: roomTypes[i % roomTypes.length]!, capacity: 30, validFrom: '2026-01-01' })
      .run()
  }

  const groupIds: number[] = []
  for (let i = 0; i < 39; i++) {
    groupIds.push(
      db
        .insert(schema.studyGroup)
        .values({
          name: `${10 + i} СД`,
          specialityId: world.specialityId,
          admissionYear: 2026,
          course: (i % 4) + 1,
          studentsCount: 20 + (i % 15),
          funding: i < 12 ? 'budget' : 'contract',
          validFrom: '2026-01-01',
        })
        .returning({ id: schema.studyGroup.id })
        .get().id,
    )
  }

  const loadIds: number[] = []
  let teacherCursor = 0
  for (const groupId of groupIds) {
    for (let u = 0; u < 10; u++) {
      loadIds.push(
        db
          .insert(schema.teachingLoad)
          .values({
            semesterId: world.semesterId,
            curriculumRowId: world.curriculumRowId,
            teacherId: teacherIds[teacherCursor++ % teacherIds.length]!,
            groupId,
            lessonKind: 'theory',
            hoursPlanned: 36,
            validFrom: '2026-01-01',
          })
          .returning({ id: schema.teachingLoad.id })
          .get().id,
      )
    }
  }

  return { loadIds }
}
