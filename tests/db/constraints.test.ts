import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('индексы и защита от конфликтов на уровне БД (§4.4)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld

  beforeEach(() => {
    ctx = createTestDb()
    world = seedMinimalWorld(ctx.db)
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  function insertLesson(overrides: Partial<typeof schema.lesson.$inferInsert> = {}) {
    return ctx.db
      .insert(schema.lesson)
      .values({
        date: '2026-09-07',
        pairNo: 1,
        teachingLoadId: world.teachingLoadId,
        teacherId: world.teacherId,
        roomId: world.roomId,
        disciplineId: world.disciplineId,
        lessonKind: 'theory',
        status: 'planned',
        operationId: world.operationId,
        ...overrides,
      })
      .run()
  }

  it('вставка второго занятия того же преподавателя в тот же слот падает с ошибкой БД (uq_lesson_teacher)', () => {
    insertLesson()
    expect(() => insertLesson({ roomId: world.roomId2 })).toThrow(/UNIQUE constraint failed/)
  })

  it('вставка второго занятия в том же кабинете в тот же слот падает с ошибкой БД (uq_lesson_room)', () => {
    insertLesson()
    expect(() => insertLesson({ teacherId: world.teacherId2 })).toThrow(/UNIQUE constraint failed/)
  })

  it('тот же преподаватель/кабинет в тот же слот разрешён, если первое занятие отменено', () => {
    insertLesson()
    ctx.db.update(schema.lesson).set({ status: 'cancelled' }).run()
    expect(() => insertLesson({ roomId: world.roomId2, teacherId: world.teacherId2 })).not.toThrow()
  })

  it('без кабинета (room_id NULL) можно поставить сколько угодно занятий в один слот (§1.1 п.11)', () => {
    insertLesson({ roomId: null, teacherId: world.teacherId })
    expect(() => insertLesson({ roomId: null, teacherId: world.teacherId2 })).not.toThrow()
  })

  it('удаление преподавателя, на которого ссылаются занятия, запрещено (ON DELETE RESTRICT)', () => {
    insertLesson()
    expect(() => ctx.db.delete(schema.teacher).where(eq(schema.teacher.id, world.teacherId)).run()).toThrow(
      /FOREIGN KEY constraint failed/,
    )
  })
})
