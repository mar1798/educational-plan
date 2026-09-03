import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  activeGroupTeachingHours,
  isTeacherQualified,
  loadBalanceByGroup,
  loadBalanceByTeacher,
  LoadValidationError,
  saveTeachingLoad,
  totalTeacherHours,
} from '../../src/main/db/repo/teaching-load'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

const baseInput = (world: MinimalWorld) => ({
  semesterId: world.semesterId,
  curriculumRowId: world.curriculumRowId,
  teacherId: world.teacherId,
  groupId: world.groupId,
  streamId: null,
  divisionSchemeId: null,
  subgroupId: null,
  lessonKind: 'theory' as const,
  hoursPlanned: 10,
  requiresParallel: false,
  roomTypeRequired: null,
  clinicalModeOverride: null,
  note: null,
})

describe('нагрузка: квалификация, недельный лимит, норма часов (§3.5, §3.7a)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld

  beforeEach(() => {
    ctx = createTestDb()
    world = seedMinimalWorld(ctx.db)
    // seedMinimalWorld заводит одну строку нагрузки для сборки lesson в других тестах —
    // здесь она мешает арифметике баланса/лимитов, поэтому убирается сразу.
    ctx.db.delete(schema.teachingLoad).where(eq(schema.teachingLoad.id, world.teachingLoadId)).run()
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('блокирует назначение без действующей квалификации преподавателя', () => {
    expect(isTeacherQualified(ctx.db, world.teacherId, world.disciplineId, '2026-09-01')).toBe(false)
    expect(() => saveTeachingLoad(ctx.db, baseInput(world), '2026-09-01', null)).toThrow(LoadValidationError)
  })

  it('разрешает назначение при действующей квалификации', () => {
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId, disciplineId: world.disciplineId, validFrom: '2020-01-01' }).run()
    const { row } = saveTeachingLoad(ctx.db, baseInput(world), '2026-09-01', null)
    expect(row.hoursPlanned).toBe(10)
  })

  it('блокирует превышение недельного лимита группы (45ч × число недель семестра)', () => {
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId, disciplineId: world.disciplineId, validFrom: '2020-01-01' }).run()
    // maxHoursPerWeek по умолчанию 45, weeksCount семестра из seedMinimalWorld не задан явно — берём дефолт схемы (18).
    const sem = ctx.db.select().from(schema.semester).where(eq(schema.semester.id, world.semesterId)).get()!
    const group = ctx.db.select().from(schema.studyGroup).where(eq(schema.studyGroup.id, world.groupId)).get()!
    const limit = group.maxHoursPerWeek * sem.weeksCount

    expect(() => saveTeachingLoad(ctx.db, { ...baseInput(world), hoursPlanned: limit + 1 }, '2026-09-01', null)).toThrow(LoadValidationError)
    expect(() => saveTeachingLoad(ctx.db, { ...baseInput(world), hoursPlanned: limit }, '2026-09-01', null)).not.toThrow()
  })

  it('считает часы группы через прямые строки и через поток одной суммой', () => {
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId, disciplineId: world.disciplineId, validFrom: '2020-01-01' }).run()
    saveTeachingLoad(ctx.db, { ...baseInput(world), hoursPlanned: 5 }, '2026-09-01', null)

    const streamId = ctx.db.insert(schema.stream).values({ semesterId: world.semesterId, name: 'Поток', validFrom: '2026-09-01' }).returning({ id: schema.stream.id }).get().id
    ctx.db.insert(schema.streamMember).values({ streamId, groupId: world.groupId, validFrom: '2026-09-01' }).run()
    ctx.db
      .insert(schema.teachingLoad)
      .values({
        semesterId: world.semesterId,
        curriculumRowId: world.curriculumRowId,
        teacherId: world.teacherId2,
        streamId,
        lessonKind: 'theory',
        hoursPlanned: 7,
        validFrom: '2026-09-01',
      })
      .run()

    expect(activeGroupTeachingHours(ctx.db, world.groupId, world.semesterId)).toBe(12)
  })

  it('возвращает предупреждение о превышении годовой нормы преподавателя, не блокируя сохранение', () => {
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId, disciplineId: world.disciplineId, validFrom: '2020-01-01' }).run()
    ctx.db.update(schema.teacher).set({ maxHoursYear: 8 }).where(eq(schema.teacher.id, world.teacherId)).run()

    const { teacherHoursOverYear } = saveTeachingLoad(ctx.db, { ...baseInput(world), hoursPlanned: 10 }, '2026-09-01', null)
    expect(teacherHoursOverYear).toBe(10)
    expect(totalTeacherHours(ctx.db, world.teacherId)).toBe(10)
  })

  it('баланс по преподавателям учитывает прочие часы, но норму — только для штатных', () => {
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId, disciplineId: world.disciplineId, validFrom: '2020-01-01' }).run()
    saveTeachingLoad(ctx.db, { ...baseInput(world), hoursPlanned: 5 }, '2026-09-01', null)
    ctx.db.insert(schema.otherLoad).values({ semesterId: world.semesterId, teacherId: world.teacherId, kind: 'method', hours: 3 }).run()

    const balance = loadBalanceByTeacher(ctx.db, world.semesterId)
    const row = balance.find((b) => b.teacherId === world.teacherId)!
    expect(row.assignedHours).toBe(5)
    expect(row.otherHours).toBe(3)
    expect(row.totalHours).toBe(8)
  })

  it('баланс по группам показывает нераспределённые часы плана', () => {
    ctx.db.update(schema.curriculum).set({ status: 'approved' }).where(eq(schema.curriculum.id, world.curriculumId)).run()
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId, disciplineId: world.disciplineId, validFrom: '2020-01-01' }).run()
    saveTeachingLoad(ctx.db, { ...baseInput(world), hoursPlanned: 20 }, '2026-09-01', null)

    const balance = loadBalanceByGroup(ctx.db, world.semesterId)
    const row = balance.find((b) => b.groupId === world.groupId)!
    // seedMinimalWorld: curriculumRow.hoursClassroom = 80, course=1, semesterNo=1; group.course=1, semester.no=1 → planSemesterNo=1.
    expect(row.plannedHours).toBe(80)
    expect(row.assignedHours).toBe(20)
    expect(row.remainingHours).toBe(60)
  })
})
