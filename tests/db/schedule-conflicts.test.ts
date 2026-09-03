import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listLessonConflicts } from '../../src/main/db/repo/schedule-template'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('сканирование конфликтов среди материализованных занятий (§5.8, задача 4.11)', () => {
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

  it('находит пересечение подгрупп между двумя занятиями одного слота (то, что не ловит уникальный индекс БД, §4.7)', () => {
    // Разные преподаватели и разные (без) кабинета — уникальные индексы БД (§4.4) здесь
    // не сработают, единственный способ поймать конфликт — пересечение позиций студентов.
    const lessonAId = ctx.db
      .insert(schema.lesson)
      .values({
        date: '2026-09-01',
        pairNo: 1,
        teachingLoadId: world.teachingLoadId,
        teacherId: world.teacherId,
        disciplineId: world.disciplineId,
        lessonKind: 'theory',
        status: 'planned',
        operationId: world.operationId,
      })
      .returning({ id: schema.lesson.id })
      .get().id
    ctx.db.insert(schema.lessonGroup).values({ lessonId: lessonAId, groupId: world.groupId, posFrom: 1, posTo: 10 }).run()

    const lessonBId = ctx.db
      .insert(schema.lesson)
      .values({
        date: '2026-09-01',
        pairNo: 1,
        teachingLoadId: world.teachingLoadId,
        teacherId: world.teacherId2,
        disciplineId: world.disciplineId,
        lessonKind: 'theory',
        status: 'planned',
        operationId: world.operationId,
      })
      .returning({ id: schema.lesson.id })
      .get().id
    ctx.db.insert(schema.lessonGroup).values({ lessonId: lessonBId, groupId: world.groupId, posFrom: 1, posTo: 15 }).run()

    const conflicts = listLessonConflicts(ctx.db, '2026-09-01', '2026-09-01')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ date: '2026-09-01', pairNo: 1, lessonAId, lessonBId })
  })

  it('не находит конфликтов, если слоты разные', () => {
    ctx.db
      .insert(schema.lesson)
      .values({ date: '2026-09-01', pairNo: 1, teachingLoadId: world.teachingLoadId, teacherId: world.teacherId, disciplineId: world.disciplineId, lessonKind: 'theory', status: 'planned', operationId: world.operationId })
      .run()
    ctx.db
      .insert(schema.lesson)
      .values({ date: '2026-09-02', pairNo: 1, teachingLoadId: world.teachingLoadId, teacherId: world.teacherId, disciplineId: world.disciplineId, lessonKind: 'theory', status: 'planned', operationId: world.operationId })
      .run()

    expect(listLessonConflicts(ctx.db, '2026-09-01', '2026-09-02')).toHaveLength(0)
  })
})
