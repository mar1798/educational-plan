import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensurePairGrid } from '../../src/main/db/repo/pair-grid'
import { runOperation } from '../../src/main/db/repo/operations'
import { applyRollout, createTemplate, placeEntry, planRollout } from '../../src/main/db/repo/schedule-template'
import { deductedHoursReport, roomUtilizationReport, teacherLoadReport } from '../../src/main/db/repo/reports'
import { applyCancelLesson, applyTeacherSwap } from '../../src/main/db/repo/substitution'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('отчёты: выполнение нагрузки, вычтенные часы, загрузка кабинетов (§этап 7)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld
  let lessonId: number

  beforeEach(() => {
    ctx = createTestDb()
    world = seedMinimalWorld(ctx.db)
    ensurePairGrid(ctx.db)

    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: world.roomId })
    const plan = planRollout(ctx.db, { templateId: tmpl.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-01' })
    runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, plan, { operationId: opId }))
    lessonId = ctx.db.select().from(schema.lesson).where(eq(schema.lesson.date, '2026-09-01')).get()!.id
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  describe('teacherLoadReport (§1.1 п.22/25/36/39)', () => {
    it('план — из teaching_load, факт — из уже проведённых/запланированных занятий, недоработка только у штатных', () => {
      const row = teacherLoadReport(ctx.db, world.academicYearId).find((r) => r.teacherId === world.teacherId)!
      expect(row.planHours).toBe(80)
      expect(row.factHours).toBe(2)
      expect(row.normHoursYear).toBe(720)
      expect(row.shortfallHours).toBe(718)
      expect(row.totalHours).toBe(row.factHours + row.otherHours)
    })

    it('отменённое занятие вычитается из факта', () => {
      applyCancelLesson(ctx.db, { lessonId, reason: null }, {})
      const row = teacherLoadReport(ctx.db, world.academicYearId).find((r) => r.teacherId === world.teacherId)!
      expect(row.factHours).toBe(0)
    })

    it('переданное по замене занятие считается факту нового преподавателя, не исходного', () => {
      ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId2, disciplineId: world.disciplineId, validFrom: '2026-01-01' }).run()
      applyTeacherSwap(ctx.db, { lessonId, substituteTeacherId: world.teacherId2, reason: null }, {})

      const rows = teacherLoadReport(ctx.db, world.academicYearId)
      expect(rows.find((r) => r.teacherId === world.teacherId)!.factHours).toBe(0)
      expect(rows.find((r) => r.teacherId === world.teacherId2)!.factHours).toBe(2)
    })

    it('прочие часы входят в итог, но не в недоработку (§1.1 п.36)', () => {
      ctx.db.insert(schema.otherLoad).values({ semesterId: world.semesterId, teacherId: world.teacherId, kind: 'method', hours: 10 }).run()
      const row = teacherLoadReport(ctx.db, world.academicYearId).find((r) => r.teacherId === world.teacherId)!
      expect(row.otherHours).toBe(10)
      expect(row.totalHours).toBe(12)
      expect(row.shortfallHours).toBe(718) // недоработка считается только по аудиторным часам
    })

    it('у внештатного/почасовика недоработка не считается (null), даже если факт есть (§1.1 п.39)', () => {
      const externalCategoryId = ctx.db
        .insert(schema.teacherCategory)
        .values({ code: 'external', titleRu: 'Внештат', normHoursYear: null })
        .returning({ id: schema.teacherCategory.id })
        .get().id
      const externalTeacherId = ctx.db
        .insert(schema.teacher)
        .values({ lastName: 'Сидоров', firstName: 'А', categoryId: externalCategoryId })
        .returning({ id: schema.teacher.id })
        .get().id

      const row = teacherLoadReport(ctx.db, world.academicYearId).find((r) => r.teacherId === externalTeacherId)!
      expect(row.normHoursYear).toBeNull()
      expect(row.shortfallHours).toBeNull()
    })

    it('норма считается от ставки, а max_hours_year нормой не является (§1.1 п.39)', () => {
      ctx.db.update(schema.teacher).set({ rate: 0.5 }).where(eq(schema.teacher.id, world.teacherId)).run()

      const hourlyCategoryId = ctx.db
        .insert(schema.teacherCategory)
        .values({ code: 'hourly', titleRu: 'Почасовик', normHoursYear: null })
        .returning({ id: schema.teacherCategory.id })
        .get().id
      // Потолок «больше не давать» у почасовика не должен превращаться в норму выработки.
      const hourlyTeacherId = ctx.db
        .insert(schema.teacher)
        .values({ lastName: 'Кузнецов', firstName: 'В', categoryId: hourlyCategoryId, maxHoursYear: 200 })
        .returning({ id: schema.teacher.id })
        .get().id

      const rows = teacherLoadReport(ctx.db, world.academicYearId)
      expect(rows.find((r) => r.teacherId === world.teacherId)!.normHoursYear).toBe(360)
      expect(rows.find((r) => r.teacherId === hourlyTeacherId)!.normHoursYear).toBeNull()
      expect(rows.find((r) => r.teacherId === hourlyTeacherId)!.shortfallHours).toBeNull()
    })
  })

  describe('deductedHoursReport', () => {
    it('считает только отменённые занятия, группируя по дисциплине и группе', () => {
      expect(deductedHoursReport(ctx.db, '2026-09-01', '2026-09-01')).toEqual([])

      applyCancelLesson(ctx.db, { lessonId, reason: null }, {})
      const rows = deductedHoursReport(ctx.db, '2026-09-01', '2026-09-01')
      expect(rows).toEqual([
        { disciplineId: world.disciplineId, disciplineName: 'Анатомия', groupId: world.groupId, groupName: '11 СД', cancelledHours: 2, cancelledCount: 1 },
      ])
    })

    it('занятия вне диапазона не учитываются', () => {
      applyCancelLesson(ctx.db, { lessonId, reason: null }, {})
      expect(deductedHoursReport(ctx.db, '2026-09-02', '2026-09-08')).toEqual([])
    })
  })

  describe('roomUtilizationReport', () => {
    it('считает занятость от учебных дней × включённых пар в сетке звонков', () => {
      ctx.db.insert(schema.calendarDay).values({ date: '2026-09-01', semesterId: world.semesterId, kind: 'study' }).run()

      const rows = roomUtilizationReport(ctx.db, '2026-09-01', '2026-09-01')
      const room1 = rows.find((r) => r.roomId === world.roomId)!
      const room2 = rows.find((r) => r.roomId === world.roomId2)!

      expect(room1.availableSlots).toBe(6) // 1 учебный день × 6 включённых пар
      expect(room1.occupiedSlots).toBe(1)
      expect(room1.idlePercent).toBeCloseTo(1 - 1 / 6)

      expect(room2.occupiedSlots).toBe(0)
      expect(room2.idlePercent).toBe(1)
    })

    it('без учебных дней в диапазоне доступность и простой равны нулю/100%', () => {
      const rows = roomUtilizationReport(ctx.db, '2026-09-01', '2026-09-01')
      const room1 = rows.find((r) => r.roomId === world.roomId)!
      expect(room1.availableSlots).toBe(0)
      expect(room1.idlePercent).toBe(0)
    })
  })
})
