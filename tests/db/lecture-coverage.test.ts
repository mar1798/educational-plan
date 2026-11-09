import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lectureCoverage, suggestLectureHours } from '../../src/main/services/lecture-coverage'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('практика после лекций: покрытие и подбор часов (этап Г)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld

  beforeEach(() => {
    ctx = createTestDb()
    world = seedMinimalWorld(ctx.db)
    ctx.db.delete(schema.teachingLoad).where(eq(schema.teachingLoad.id, world.teachingLoadId)).run()
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  function addLoad(lessonKind: 'theory' | 'practice' | 'seminar' | 'lab', hoursPlanned: number, extra: Partial<typeof schema.teachingLoad.$inferInsert> = {}) {
    return ctx.db
      .insert(schema.teachingLoad)
      .values({
        semesterId: world.semesterId,
        curriculumRowId: world.curriculumRowId,
        teacherId: world.teacherId,
        groupId: world.groupId,
        lessonKind,
        hoursPlanned,
        validFrom: '2026-09-01',
        ...extra,
      })
      .returning({ id: schema.teachingLoad.id })
      .get().id
  }

  it('лекции руками на весь семестр, практика с 4-й недели: к её началу пройдено 3 из 18 недель ≈ 17 %', () => {
    addLoad('theory', 36, { weekTo: 18 })
    addLoad('practice', 30)
    const [item] = lectureCoverage(ctx.db, { semesterId: world.semesterId })
    expect(item).toMatchObject({ practiceFromWeek: 4, coveredHours: 6, totalHours: 36, percent: 17, ok: false })
    expect(item!.message).toContain('пройдено 6 из 36 ч')
  })

  it('без ручных недель лекции идут первыми (решение 53): практика начинается после них, предупреждения нет', () => {
    addLoad('theory', 36)
    addLoad('practice', 30)
    // 18 недель делятся пропорционально часам: 18 × 36 / 66 ≈ 10 недель лекций, практика с 11-й
    expect(lectureCoverage(ctx.db, { semesterId: world.semesterId })[0]).toMatchObject({ practiceFromWeek: 11, coveredHours: 36, percent: 100, ok: true })
  })

  it('лекции по 8 ч/нед заканчиваются раньше практики — порог выдержан', () => {
    addLoad('theory', 24, { hoursPerWeek: 8 })
    addLoad('practice', 30)
    expect(lectureCoverage(ctx.db, { semesterId: world.semesterId })[0]).toMatchObject({ coveredHours: 24, percent: 100, ok: true })
  })

  it('семинары и лабораторные лекциями не считаются, пара без практики не проверяется', () => {
    addLoad('theory', 36)
    addLoad('seminar', 18)
    expect(lectureCoverage(ctx.db, { semesterId: world.semesterId })).toEqual([])
  })

  it('черновик из диалога подменяет сохранённую строку, порог берётся из настройки', () => {
    const theory = addLoad('theory', 36, { weekTo: 18 })
    addLoad('practice', 30)
    ctx.db.insert(schema.appSetting).values({ key: 'lecture_coverage_before_practice', value: '15' }).run()
    const draft = { id: theory, curriculumRowId: world.curriculumRowId, groupId: world.groupId, streamId: null, lessonKind: 'theory' as const, hoursPlanned: 36, hoursPerWeek: 12 }
    expect(lectureCoverage(ctx.db, { semesterId: world.semesterId })[0]).toMatchObject({ percent: 17, ok: true, threshold: 15 })
    expect(lectureCoverage(ctx.db, { semesterId: world.semesterId, draft })[0]).toMatchObject({ percent: 100, ok: true })
  })

  it('подбор: минимальные ч/нед, кратные 2, чтобы к 4-й неделе было ≥ 80 %', () => {
    const theory = addLoad('theory', 36)
    addLoad('practice', 30, { weekFrom: 4 })
    const draft = { id: theory, curriculumRowId: world.curriculumRowId, groupId: world.groupId, streamId: null, lessonKind: 'theory' as const, hoursPlanned: 36 }
    // нужно 29 ч за 3 недели → 10 ч/нед (округление вверх до чётного)
    expect(suggestLectureHours(ctx.db, { semesterId: world.semesterId, draft })).toMatchObject({ hoursPerWeek: 10, fits: true, shortfall: 0 })
  })

  it('подбор упирается в недельный лимит группы: сообщает, сколько не хватает', () => {
    const theory = addLoad('theory', 36)
    addLoad('practice', 30, { weekFrom: 4 })
    ctx.db.update(schema.studyGroup).set({ maxHoursPerWeek: 8 }).where(eq(schema.studyGroup.id, world.groupId)).run()
    addLoad('seminar', 90, { hoursPerWeek: 5 }) // 5 ч/нед в неделях 1–18
    const draft = { id: theory, curriculumRowId: world.curriculumRowId, groupId: world.groupId, streamId: null, lessonKind: 'theory' as const, hoursPlanned: 36 }
    // нужно 10 ч/нед, а свободно только 3: 5 + 10 − 8 = 7 ч не хватает
    expect(suggestLectureHours(ctx.db, { semesterId: world.semesterId, draft })).toMatchObject({ hoursPerWeek: 10, fits: false, shortfall: 7 })
  })

  it('подбор при практике без заданного начала: не нужен, практика сама встанет после лекций', () => {
    const theory = addLoad('theory', 36)
    addLoad('practice', 30)
    const draft = { id: theory, curriculumRowId: world.curriculumRowId, groupId: world.groupId, streamId: null, lessonKind: 'theory' as const, hoursPlanned: 36 }
    expect(suggestLectureHours(ctx.db, { semesterId: world.semesterId, draft })).toMatchObject({ hoursPerWeek: null, fits: true })
  })

  it('лекция потока и практика группы сопоставляются: проверка п. 51 не выпадает после объединения', () => {
    const streamId = ctx.db.insert(schema.stream).values({ semesterId: world.semesterId, name: 'Поток', validFrom: '2026-09-01' }).returning({ id: schema.stream.id }).get().id
    ctx.db.insert(schema.streamMember).values({ streamId, groupId: world.groupId, validFrom: '2026-09-01' }).run()
    addLoad('theory', 36, { groupId: null, streamId, weekTo: 18 })
    addLoad('practice', 30)
    const [item] = lectureCoverage(ctx.db, { semesterId: world.semesterId })
    expect(item).toMatchObject({ groupId: world.groupId, streamId, practiceFromWeek: 4, percent: 17, ok: false })
    expect(lectureCoverage(ctx.db, { semesterId: world.semesterId, streamId })).toHaveLength(1)
  })

  it('практика с 1-й недели: лекциям до неё не остаётся недель', () => {
    const theory = addLoad('theory', 36)
    addLoad('practice', 30, { weekFrom: 1 })
    const draft = { id: theory, curriculumRowId: world.curriculumRowId, groupId: world.groupId, streamId: null, lessonKind: 'theory' as const, hoursPlanned: 36 }
    expect(suggestLectureHours(ctx.db, { semesterId: world.semesterId, draft })).toMatchObject({ hoursPerWeek: null, fits: false })
  })
})
