import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  activeGroupTeachingHours,
  isTeacherQualified,
  loadBalanceByGroup,
  loadBalanceByTeacher,
  LoadValidationError,
  planRowOptions,
  saveTeachingLoad,
  totalTeacherHours,
} from '../../src/main/db/repo/teaching-load'
import { createStream } from '../../src/main/db/repo/stream'
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
  sessionHours: 2 as const,
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

  it('длительность 4–6 часов — только у практики (п. 48)', () => {
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId, disciplineId: world.disciplineId, validFrom: '2020-01-01' }).run()
    expect(() => saveTeachingLoad(ctx.db, { ...baseInput(world), sessionHours: 6 }, '2026-09-01', null)).toThrow(LoadValidationError)
    const { row } = saveTeachingLoad(ctx.db, { ...baseInput(world), lessonKind: 'practice', sessionHours: 6 }, '2026-09-01', null)
    expect(row.sessionHours).toBe(6)
  })

  it('у параллельных подгрупп длительность занятия должна совпадать (п. 48)', () => {
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId, disciplineId: world.disciplineId, validFrom: '2020-01-01' }).run()
    const practice = { ...baseInput(world), lessonKind: 'practice' as const, sessionHours: 4 as const }
    const a = saveTeachingLoad(ctx.db, practice, '2026-09-01', null).row as { id: number; rowVersion: number }
    const b = saveTeachingLoad(ctx.db, practice, '2026-09-01', null).row as { id: number }
    ctx.db.update(schema.teachingLoad).set({ pairedLoadId: b.id }).where(eq(schema.teachingLoad.id, a.id)).run()

    expect(() => saveTeachingLoad(ctx.db, { ...practice, sessionHours: 6 }, '2026-09-01', a)).toThrow(/параллельной подгруппы/)
    const { row } = saveTeachingLoad(ctx.db, { ...practice, hoursPlanned: 12 }, '2026-09-01', a)
    expect(row.hoursPlanned).toBe(12)
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

  describe('цель нагрузки и строка плана', () => {
    const qualify = () =>
      ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId, disciplineId: world.disciplineId, validFrom: '2020-01-01' }).run()

    const addGroup = (name: string, course: number) =>
      ctx.db
        .insert(schema.studyGroup)
        .values({ name, specialityId: world.specialityId, admissionYear: 2026, course, studentsCount: 20, funding: 'budget', validFrom: '2026-01-01' })
        .returning({ id: schema.studyGroup.id })
        .get().id

    it('отклоняет строку плана чужого курса', () => {
      qualify()
      const course2 = addGroup('21 СД', 2)
      expect(() => saveTeachingLoad(ctx.db, { ...baseInput(world), groupId: course2 }, '2026-09-01', null)).toThrow(/не подходит группе «21 СД»/)
    })

    it('принимает нагрузку потоку, если строка плана подходит всем участникам', () => {
      qualify()
      const s = createStream(ctx.db, { semesterId: world.semesterId, name: 'Поток', groupIds: [world.groupId, addGroup('12 СД', 1)], validFrom: '2026-09-01' })
      const { row } = saveTeachingLoad(ctx.db, { ...baseInput(world), groupId: null, streamId: s.id }, '2026-09-01', null)
      expect(row.streamId).toBe(s.id)
    })

    it('не ставит подгруппу на поток — при расформировании она расползлась бы по группам', () => {
      qualify()
      const s = createStream(ctx.db, { semesterId: world.semesterId, name: 'Поток', groupIds: [world.groupId, addGroup('12 СД', 1)], validFrom: '2026-09-01' })
      expect(() =>
        saveTeachingLoad(ctx.db, { ...baseInput(world), groupId: null, streamId: s.id, divisionSchemeId: 1, subgroupId: 1 }, '2026-09-01', null),
      ).toThrow(LoadValidationError)
    })

    it('список строк плана — только те, что пройдут проверку при записи', () => {
      const foreign = ctx.db
        .insert(schema.curriculumRow)
        .values({ curriculumId: world.curriculumId, disciplineId: world.disciplineId, course: 2, semesterNo: 3, credits: 4, hoursTotal: 120, hoursClassroom: 80, validFrom: '2026-01-01' })
        .returning({ id: schema.curriculumRow.id })
        .get().id
      const ids = planRowOptions(ctx.db, { semesterId: world.semesterId, groupId: world.groupId, streamId: null }).map((r) => r.id)
      expect(ids).toEqual([world.curriculumRowId])
      expect(ids).not.toContain(foreign)

      const s = createStream(ctx.db, { semesterId: world.semesterId, name: 'Поток', groupIds: [world.groupId, addGroup('12 СД', 1)], validFrom: '2026-09-01' })
      expect(planRowOptions(ctx.db, { semesterId: world.semesterId, groupId: null, streamId: s.id }).map((r) => r.id)).toEqual([world.curriculumRowId])
      expect(planRowOptions(ctx.db, { semesterId: world.semesterId, groupId: null, streamId: null })).toEqual([])
    })

    it('не берёт поток из другого полугодия', () => {
      qualify()
      const s = createStream(ctx.db, { semesterId: world.semesterId, name: 'Поток', groupIds: [world.groupId, addGroup('12 СД', 1)], validFrom: '2026-09-01' })
      const sem = ctx.db.select().from(schema.semester).where(eq(schema.semester.id, world.semesterId)).get()!
      const other = ctx.db
        .insert(schema.semester)
        .values({ academicYearId: sem.academicYearId, no: 2, startsOn: '2027-02-01', endsOn: '2027-06-30' })
        .returning({ id: schema.semester.id })
        .get().id
      expect(() => saveTeachingLoad(ctx.db, { ...baseInput(world), semesterId: other, groupId: null, streamId: s.id }, '2026-09-01', null)).toThrow(
        /другом полугодии/,
      )
    })
  })
})
