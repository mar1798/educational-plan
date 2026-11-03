import { eq } from 'drizzle-orm'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { undoOperation, runOperation } from '../../src/main/db/repo/operations'
import { createTemplate, templateEntriesView } from '../../src/main/db/repo/schedule-template'
import { exportCollegeScheduleExcel } from '../../src/main/export/college-schedule'
import { ensurePairGrid } from '../../src/main/db/repo/pair-grid'
import { applyGridImport, planGridImport } from '../../src/main/import/grid/apply'
import { readSheetGrid } from '../../src/main/import/workbook'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from '../db/helpers'

/** Круговой тест: выгрузка этапа Б → загрузка этапа Ж даёт тот же шаблон (синтетические данные, без настоящих ФИО). */
describe('загрузка расписания из сетки колледжа (этап Ж)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld
  let sourceTemplateId: number
  const loads: Record<string, number> = {}

  beforeEach(() => {
    ctx = createTestDb()
    ensurePairGrid(ctx.db)
    world = seedMinimalWorld(ctx.db)
    const db = ctx.db

    const teacher = (lastName: string, firstName: string) =>
      db.insert(schema.teacher).values({ lastName, firstName, categoryId: world.teacherCategoryId }).returning({ id: schema.teacher.id }).get().id
    const sidorov = teacher('Сидоров', 'Олег')
    const kozlov = teacher('Козлов', 'Павел')

    const row = (name: string, shortName: string | null) => {
      const disciplineId = db.insert(schema.discipline).values({ name, shortName, block: 1, cycle: 'spo3', part: 'base' }).returning({ id: schema.discipline.id }).get().id
      return db
        .insert(schema.curriculumRow)
        .values({ curriculumId: world.curriculumId, disciplineId, course: 1, semesterNo: 1, credits: 2, hoursTotal: 36, hoursClassroom: 36, validFrom: '2026-01-01' })
        .returning({ id: schema.curriculumRow.id })
        .get().id
    }
    const kyrgyz = row('Кыргызский язык', 'Кырг. яз.')
    const english = row('Иностранный язык', 'Ин. яз.')
    const ophthalm = row('Офтальмология', 'Офт.')
    const biology = row('Биология', null) // сокращения нет — узнаётся по полному названию

    const group2 = db
      .insert(schema.studyGroup)
      .values({ name: '12 СД', specialityId: world.specialityId, admissionYear: 2026, course: 1, studentsCount: 24, funding: 'budget', validFrom: '2026-01-01' })
      .returning({ id: schema.studyGroup.id })
      .get().id
    const streamId = db.insert(schema.stream).values({ semesterId: world.semesterId, name: 'Поток биологии', validFrom: '2026-01-01' }).returning({ id: schema.stream.id }).get().id
    for (const groupId of [world.groupId, group2]) db.insert(schema.streamMember).values({ streamId, groupId, validFrom: '2026-01-01' }).run()

    const scheme = (name: string, clinicalSplit: 'manual' | null) => {
      const schemeId = db
        .insert(schema.divisionScheme)
        .values({ groupId: world.groupId, semesterId: world.semesterId, name, partsCount: 2, clinicalSplit, validFrom: '2026-01-01' })
        .returning({ id: schema.divisionScheme.id })
        .get().id
      const sg = (no: number, posFrom: number, posTo: number) =>
        db.insert(schema.subgroup).values({ groupId: world.groupId, schemeId, no, posFrom, posTo, validFrom: '2026-01-01' }).returning({ id: schema.subgroup.id }).get().id
      return { schemeId, first: sg(1, 1, 13), second: sg(2, 14, 25) }
    }
    const plain = scheme('Языки', null)
    const clinical = scheme('Клинические', 'manual')

    const load = (key: string, curriculumRowId: number, teacherId: number, extra: Partial<typeof schema.teachingLoad.$inferInsert>) => {
      loads[key] = db
        .insert(schema.teachingLoad)
        .values({ semesterId: world.semesterId, curriculumRowId, teacherId, lessonKind: 'practice', hoursPlanned: 36, validFrom: '2026-01-01', ...extra })
        .returning({ id: schema.teachingLoad.id })
        .get().id
    }
    loads.anatomy = world.teachingLoadId
    load('kyrgyz', kyrgyz, world.teacherId2, { groupId: world.groupId, divisionSchemeId: plain.schemeId, subgroupId: plain.first })
    load('english', english, sidorov, { groupId: world.groupId, divisionSchemeId: plain.schemeId, subgroupId: plain.second })
    load('ophthalm', ophthalm, kozlov, { groupId: world.groupId, divisionSchemeId: clinical.schemeId, subgroupId: clinical.second })
    load('biology', biology, world.teacherId2, { streamId, lessonKind: 'theory' })

    sourceTemplateId = createTemplate(db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null }).id as number
    const put = (dayOfWeek: number, pairNo: number, key: string) =>
      db.insert(schema.templateEntry).values({ templateId: sourceTemplateId, dayOfWeek, pairNo, teachingLoadId: loads[key]!, roomId: null, weekParity: 'all', isLocked: false, source: 'manual' }).run()
    put(1, 1, 'anatomy')
    put(2, 1, 'kyrgyz')
    put(2, 1, 'english')
    put(3, 2, 'ophthalm')
    put(4, 3, 'biology')
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  const signature = (templateId: number) =>
    templateEntriesView(ctx.db, templateId)
      .map((e) => `${e.dayOfWeek}:${e.pairNo}:${e.teachingLoadId}`)
      .sort()

  async function exportedGrid() {
    const filePath = join(ctx.dir, 'college.xlsx')
    await exportCollegeScheduleExcel(ctx.db, sourceTemplateId, filePath)
    return readSheetGrid(filePath, 'Расписание')
  }

  it('круговой тест: экспорт → загрузка даёт тот же шаблон; поток — одна запись, записи закреплены', async () => {
    const grid = await exportedGrid()
    const result = runOperation(ctx.db, 'import', {}, (tx, operationId) => applyGridImport(tx, grid, { semesterId: world.semesterId }, { operationId, reason: 'тест' }))

    expect(result.result.plan.problems).toEqual([])
    expect(result.result.plan.conflicts).toEqual([])
    expect(signature(result.result.templateId)).toEqual(signature(sourceTemplateId))
    expect(templateEntriesView(ctx.db, result.result.templateId).every((e) => e.isLocked)).toBe(true)

    // Откат одним действием убирает версию.
    const versions = ctx.db.select().from(schema.scheduleTemplate).all().length
    undoOperation(ctx.db, result.operationId)
    expect(ctx.db.select().from(schema.scheduleTemplate).all().length).toBe(versions - 1)
  })

  it('неизвестное сокращение: в проблемах и в списке привязки; привязка запоминается в справочнике', async () => {
    const grid = await exportedGrid()
    const eng = ctx.db.select().from(schema.discipline).where(eq(schema.discipline.name, 'Иностранный язык')).get()!
    ctx.db.update(schema.discipline).set({ shortName: null }).where(eq(schema.discipline.id, eng.id)).run()
    ctx.db.update(schema.discipline).set({ name: 'Английский' }).where(eq(schema.discipline.id, eng.id)).run()

    const preview = planGridImport(ctx.db, grid, { semesterId: world.semesterId }).plan
    expect(preview.unknownAbbreviations.map((u) => u.abbr)).toEqual(['Ин. яз.'])
    expect(preview.problems.some((p) => p.reason.includes('неизвестное сокращение'))).toBe(true)
    expect(preview.entries).toHaveLength(4)

    const { result } = runOperation(ctx.db, 'import', {}, (tx, operationId) =>
      applyGridImport(tx, grid, { semesterId: world.semesterId, bindings: { 'Ин. яз.': eng.id } }, { operationId, reason: 'тест' }),
    )
    expect(result.plan.problems).toEqual([])
    expect(result.created).toBe(5)
    expect(ctx.db.select().from(schema.discipline).where(eq(schema.discipline.id, eng.id)).get()!.shortName).toBe('Ин. яз.')
    // В следующий раз распознаётся само.
    expect(planGridImport(ctx.db, grid, { semesterId: world.semesterId }).plan.unknownAbbreviations).toEqual([])
  })

  it('нет строки нагрузки или преподавателя: причина в проблемах, запись молча не создаётся', async () => {
    const grid = await exportedGrid()
    ctx.db.delete(schema.templateEntry).where(eq(schema.templateEntry.teachingLoadId, loads.ophthalm!)).run()
    ctx.db.delete(schema.teachingLoad).where(eq(schema.teachingLoad.id, loads.ophthalm!)).run()
    ctx.db.update(schema.teacher).set({ lastName: 'Другой' }).where(eq(schema.teacher.lastName, 'Сидоров')).run()

    const plan = planGridImport(ctx.db, grid, { semesterId: world.semesterId }).plan
    expect(plan.entries).toHaveLength(3)
    expect(plan.problems.map((p) => p.reason)).toEqual(expect.arrayContaining([expect.stringContaining('нет строки «Офт.»'), expect.stringContaining('преподаватель «Сидоров О.» не найден')]))
  })

  it('конфликты внутри файла показываются, но записи не теряются', async () => {
    const grid = await exportedGrid()
    // В файле английский ведёт тот же преподаватель, что и кыргызский, в ту же пару.
    for (const row of grid)
      row.forEach((c, i) => {
        if (typeof c === 'string') row[i] = c.replace('Сидоров О.', 'Петров С.')
      })
    ctx.db.update(schema.teachingLoad).set({ teacherId: world.teacherId2 }).where(eq(schema.teachingLoad.id, loads.english!)).run()
    const plan = planGridImport(ctx.db, grid, { semesterId: world.semesterId }).plan
    expect(plan.conflicts.length).toBeGreaterThan(0)
    expect(plan.entries).toHaveLength(5)
  })

  it('лекция и практика одной дисциплины: занятия делятся по недельной норме строк, а не по порядку', async () => {
    // Биология у потока — теория 36 ч (1 занятие в неделю). Добавляем практику 72 ч (2 занятия в неделю) тому же потоку.
    const bioRow = ctx.db.select().from(schema.teachingLoad).where(eq(schema.teachingLoad.id, loads.biology!)).get()!
    const practice = ctx.db
      .insert(schema.teachingLoad)
      .values({ semesterId: world.semesterId, curriculumRowId: bioRow.curriculumRowId, teacherId: bioRow.teacherId, streamId: bioRow.streamId, lessonKind: 'practice', hoursPlanned: 72, validFrom: '2026-01-01' })
      .returning({ id: schema.teachingLoad.id })
      .get().id
    const put = (day: number, pair: number, id: number) =>
      ctx.db.insert(schema.templateEntry).values({ templateId: sourceTemplateId, dayOfWeek: day, pairNo: pair, teachingLoadId: id, roomId: null, weekParity: 'all', isLocked: false, source: 'manual' }).run()
    put(5, 1, practice)
    put(5, 2, practice)

    const grid = await exportedGrid()
    const plan = planGridImport(ctx.db, grid, { semesterId: world.semesterId }).plan
    const byLoad = (id: number) => plan.entries.filter((e) => e.teachingLoadId === id).length
    // Всего 3 занятия биологии: одно (по норме) лекции и два практики, а не 2 + 1 по порядку id.
    expect(byLoad(loads.biology!)).toBe(1)
    expect(byLoad(practice)).toBe(2)
  })
})
