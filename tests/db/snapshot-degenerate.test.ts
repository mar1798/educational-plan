/**
 * Регрессии сборки снимка (§5.2, §4.6 PLAN.md) на вырожденных данных: значения, которые
 * схема БД пропускает, а zod-контракт проверяет только на входе через IPC — то есть всё,
 * что может прийти из восстановленного или отредактированного извне файла базы.
 */
import { rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as schema from '../../src/main/db/schema'
import { hasPendingMigrations, runMigrations } from '../../src/main/db/migrate'
import { createTemplate, placeEntry } from '../../src/main/db/repo/schedule-template'
import { buildSolverInput } from '../../src/main/services/snapshot'
import { POSITIONS, slotIndex } from '../../src/solver/model'
import { createTestDb, seedMinimalWorld } from './helpers'
import { join } from 'node:path'

function makeTemplate(db: ReturnType<typeof createTestDb>['db'], semesterId: number): number {
  return createTemplate(db, { semesterId, effectiveFrom: '2026-09-01', note: null, copyFromTemplateId: null }, {}).id as number
}

describe('снимок: группа за пределом 64 позиций', () => {
  it('не урезает группу молча, а называет её завучу', () => {
    const { db } = createTestDb()
    const w = seedMinimalWorld(db)
    db.update(schema.studyGroup).set({ studentsCount: POSITIONS + 6 }).where(eq(schema.studyGroup.id, w.groupId)).run()
    const templateId = makeTemplate(db, w.semesterId)

    expect(() => buildSolverInput(db, templateId, 1)).toThrow(/предел модели/)
  })

  it('ровно 64 позиции — ещё в пределах модели', () => {
    const { db } = createTestDb()
    const w = seedMinimalWorld(db)
    db.update(schema.studyGroup).set({ studentsCount: POSITIONS }).where(eq(schema.studyGroup.id, w.groupId)).run()
    const templateId = makeTemplate(db, w.semesterId)

    const input = buildSolverInput(db, templateId, 1)
    expect(input.units[0]!.students).toBe(POSITIONS)
  })
})

describe('снимок: вырожденное число недель семестра', () => {
  it('weeksCount = 0 даёт понятную ошибку, а не бесконечный цикл', () => {
    const { db } = createTestDb()
    const w = seedMinimalWorld(db)
    db.update(schema.semester).set({ weeksCount: 0 }).where(eq(schema.semester.id, w.semesterId)).run()
    const templateId = makeTemplate(db, w.semesterId)

    const started = Date.now()
    expect(() => buildSolverInput(db, templateId, 1)).toThrow(/недел/)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe('бэкап перед миграцией снимается только когда есть что мигрировать', () => {
  it('на свежесмигрированной базе непримененных миграций нет', () => {
    const { db, sqlite } = createTestDb()
    const folder = join(__dirname, '../../drizzle')
    expect(hasPendingMigrations(sqlite, folder)).toBe(false)
    runMigrations(db, folder)
    expect(hasPendingMigrations(sqlite, folder)).toBe(false)
  })

  it('на базе без таблицы миграций миграции считаются непримененными', () => {
    const { sqlite } = createTestDb()
    sqlite.prepare('drop table __drizzle_migrations').run()
    expect(hasPendingMigrations(sqlite, join(__dirname, '../../drizzle'))).toBe(true)
  })
})

describe('закреплённая запись закрытой группы', () => {
  // Закреплённое занятие держит преподавателя и кабинет даже без слушателей. Если оно
  // выпадает из `fixed`, солвер считает слот свободным, validateSolution нарушения не видит,
  // и applySolution падает на findConflicts уже после минуты расчёта.
  it('остаётся препятствием в fixed, когда её группу закрыли', () => {
    const ctx = createTestDb()
    const world = seedMinimalWorld(ctx.db)
    try {
      const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
      const entry = placeEntry(ctx.db, {
        templateId: tmpl.id as number,
        teachingLoadId: world.teachingLoadId,
        dayOfWeek: 1,
        pairNo: 2,
        roomId: world.roomId,
        weekParity: 'all',
      })
      ctx.db
        .update(schema.templateEntry)
        .set({ isLocked: true })
        .where(eq(schema.templateEntry.id, entry.id as number))
        .run()

      // Группу закрывают уже после того, как занятие закрепили в шаблоне.
      ctx.db.update(schema.studyGroup).set({ validTo: '2026-09-02' }).where(eq(schema.studyGroup.id, world.groupId)).run()

      const input = buildSolverInput(ctx.db, tmpl.id as number, 1)
      const blocked = input.fixed.filter((f) => f.slot === slotIndex(1, 2))
      expect(blocked).toHaveLength(1)
      expect(input.teachers[blocked[0]!.teacherIdx]!.id).toBe(world.teacherId)
      expect(blocked[0]!.roomIdx).not.toBeNull()
    } finally {
      ctx.sqlite.close()
      rmSync(ctx.dir, { recursive: true, force: true })
    }
  })
})
