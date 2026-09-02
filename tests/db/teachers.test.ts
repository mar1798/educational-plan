import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteRow } from '../../src/main/db/repo/base-repo'
import { ensureDeletable, ReferencedError } from '../../src/main/db/repo/reference-guard'
import { ensureTeacherCategories } from '../../src/main/db/repo/seed'
import { countAffectedLoad } from '../../src/main/db/repo/teaching-load-guard'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('преподаватели (§2.3)', () => {
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

  it('ensureTeacherCategories заводит ровно три категории и идемпотентна', () => {
    ensureTeacherCategories(ctx.db)
    ensureTeacherCategories(ctx.db)

    const rows = ctx.db.select().from(schema.teacherCategory).all()
    // seedMinimalWorld уже создал одну категорию 'staff' — ensureTeacherCategories не должна её дублировать.
    expect(rows.filter((r) => r.code === 'staff')).toHaveLength(1)
    expect(rows.map((r) => r.code).sort()).toEqual(['external', 'hourly', 'staff'])
  })

  it('блокирует удаление преподавателя, у которого есть квалификация', () => {
    ctx.db
      .insert(schema.teacherQualification)
      .values({ teacherId: world.teacherId, disciplineId: world.disciplineId, validFrom: '2026-01-01' })
      .run()

    expect(() =>
      ensureDeletable(ctx.db, `Преподаватель «Иванова Т»`, world.teacherId, [
        { table: schema.teacherQualification, column: schema.teacherQualification.teacherId, nounRu: 'квалификациях' },
      ]),
    ).toThrow(ReferencedError)
  })

  it('преподаватель без ссылок удаляется физически', () => {
    const id = ctx.db
      .insert(schema.teacher)
      .values({ lastName: 'Лишний', firstName: 'Т', categoryId: world.teacherCategoryId })
      .returning({ id: schema.teacher.id })
      .get().id

    deleteRow(ctx.db, schema.teacher, id, { reason: 'тест' })
    expect(ctx.db.select().from(schema.teacher).where(eq(schema.teacher.id, id)).get()).toBeUndefined()
  })

  it('countAffectedLoad считает строки нагрузки по преподавателю и дисциплине через curriculum_row', () => {
    // seedMinimalWorld уже создал teachingLoadId для teacherId+curriculumRowId(disciplineId).
    expect(countAffectedLoad(ctx.db, world.teacherId, world.disciplineId)).toBe(1)
    expect(countAffectedLoad(ctx.db, world.teacherId2, world.disciplineId)).toBe(0)
  })
})
