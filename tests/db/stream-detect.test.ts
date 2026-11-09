import ExcelJS from 'exceljs'
import { and, eq, isNull } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runOperation, undoOperation } from '../../src/main/db/repo/operations'
import { ensurePairGrid } from '../../src/main/db/repo/pair-grid'
import { createTemplate, placeEntry } from '../../src/main/db/repo/schedule-template'
import { exportCollegeScheduleExcel } from '../../src/main/export/college-schedule'
import { detectStreamCandidates, mergeStreamCandidates } from '../../src/main/services/stream-detect'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('поточные лекции: поиск, объединение и вид в сводной сетке (решение 54)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld
  let group2: number
  let load2: number

  beforeEach(() => {
    ctx = createTestDb()
    ensurePairGrid(ctx.db)
    world = seedMinimalWorld(ctx.db)
    group2 = ctx.db
      .insert(schema.studyGroup)
      .values({ name: '12 СД', specialityId: world.specialityId, admissionYear: 2026, course: 1, studentsCount: 20, funding: 'budget', validFrom: '2026-01-01' })
      .returning({ id: schema.studyGroup.id })
      .get().id
    const first = ctx.db.select().from(schema.teachingLoad).where(eq(schema.teachingLoad.id, world.teachingLoadId)).get()!
    const { id: _id, createdAt: _c, updatedAt: _u, rowVersion: _v, ...rest } = first
    load2 = ctx.db
      .insert(schema.teachingLoad)
      .values({ ...rest, groupId: group2 })
      .returning({ id: schema.teachingLoad.id })
      .get().id
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('одна лекция одного преподавателя двум группам курса — кандидат; другой преподаватель — нет', () => {
    const [c, ...more] = detectStreamCandidates(ctx.db, world.semesterId)
    expect(more).toEqual([])
    expect(c).toMatchObject({ loadIds: [world.teachingLoadId, load2], groupNames: ['11 СД', '12 СД'], disciplineName: 'Анатомия', blocked: null })

    ctx.db.update(schema.teachingLoad).set({ teacherId: world.teacherId2 }).where(eq(schema.teachingLoad.id, load2)).run()
    expect(detectStreamCandidates(ctx.db, world.semesterId)).toEqual([])
  })

  it('объединение: одна строка потока вместо строк групп, черновые записи сняты, откат возвращает как было', () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 1, pairNo: 1, weekParity: 'all', roomId: null })
    const [c] = detectStreamCandidates(ctx.db, world.semesterId)
    expect(c!.draftEntries).toBe(1)

    const { operationId, result } = runOperation(ctx.db, 'bulk_edit', {}, (tx, opId) => mergeStreamCandidates(tx, world.semesterId, [c!.key], { operationId: opId }))
    expect(result).toEqual({ merged: 1, streamsCreated: 1, removedEntries: 1, skipped: [] })
    const active = ctx.db.select().from(schema.teachingLoad).where(isNull(schema.teachingLoad.validTo)).all()
    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({ groupId: null, lessonKind: 'theory' })
    expect(active[0]!.streamId).not.toBeNull()
    expect(detectStreamCandidates(ctx.db, world.semesterId)).toEqual([])

    undoOperation(ctx.db, operationId)
    const restored = ctx.db.select().from(schema.teachingLoad).where(and(isNull(schema.teachingLoad.validTo))).all()
    expect(restored.map((l) => l.groupId).sort()).toEqual([world.groupId, group2].sort())
  })

  it('повтор одного ключа не роняет объединение', () => {
    const [c] = detectStreamCandidates(ctx.db, world.semesterId)
    expect(mergeStreamCandidates(ctx.db, world.semesterId, [c!.key, c!.key])).toMatchObject({ merged: 1, skipped: [] })
  })

  it('уже раскатанные занятия объединять не даёт — с причиной', () => {
    ctx.db
      .insert(schema.lesson)
      .values({ date: '2026-09-07', pairNo: 1, teachingLoadId: load2, teacherId: world.teacherId, disciplineId: world.disciplineId, lessonKind: 'theory', status: 'planned', operationId: world.operationId })
      .run()
    const [c] = detectStreamCandidates(ctx.db, world.semesterId)
    expect(c!.blocked).toMatch(/раскатаны/)
    const result = mergeStreamCandidates(ctx.db, world.semesterId, [c!.key])
    expect(result.merged).toBe(0)
    expect(result.skipped[0]).toMatch(/раскатаны/)
  })

  it('в сводной выгрузке поток — одна объединённая ячейка на соседние группы с пометкой «(поток)»', async () => {
    const [c] = detectStreamCandidates(ctx.db, world.semesterId)
    mergeStreamCandidates(ctx.db, world.semesterId, [c!.key])
    const streamLoad = ctx.db.select().from(schema.teachingLoad).where(isNull(schema.teachingLoad.validTo)).get()!
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: streamLoad.id, dayOfWeek: 1, pairNo: 1, weekParity: 'all', roomId: null })

    const filePath = join(ctx.dir, 'stream.xlsx')
    await exportCollegeScheduleExcel(ctx.db, tmpl.id as number, filePath)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    expect(wb.worksheets).toHaveLength(1)
    const sheet = wb.worksheets[0]!
    expect([sheet.getCell(3, 4).value, sheet.getCell(3, 5).value]).toEqual(['11 СД', '12 СД'])
    expect(sheet.getCell(4, 4).value).toBe('Анатомия (поток)')
    expect(sheet.getCell(4, 5).isMerged).toBe(true)
    expect(sheet.getCell(4, 5).master.address).toBe(sheet.getCell(4, 4).address)
    expect(sheet.getCell(5, 5).master.address).toBe(sheet.getCell(5, 4).address)
  })
})
