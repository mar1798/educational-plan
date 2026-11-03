import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTemplate, placeEntry, summaryGroupColumns, templateEntriesView } from '../../src/main/db/repo/schedule-template'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('сводное расписание: порядок колонок и разметка записей (этап А)', () => {
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

  function addGroup(name: string, specialityId: number, course: number, funding: 'budget' | 'contract') {
    return ctx.db
      .insert(schema.studyGroup)
      .values({ name, specialityId, admissionYear: 2026, course, studentsCount: 20, funding, validFrom: '2026-01-01' })
      .returning({ id: schema.studyGroup.id })
      .get().id
  }

  it('курс → порядок специальности → бюджет раньше контракта → номер; специальность без порядка идёт в конец', () => {
    const lab = ctx.db.insert(schema.speciality).values({ code: 'ЛД', name: 'Лечебное дело', sortOrder: 0 }).returning({ id: schema.speciality.id }).get().id
    const contract = addGroup('КЛД-11', lab, 1, 'contract')
    const second = addGroup('ЛД-12', lab, 1, 'budget')
    const first = addGroup('ЛД-11', lab, 1, 'budget')
    const secondCourse = addGroup('ЛД-21', lab, 2, 'budget')

    // «11 СД» из seedMinimalWorld — специальность без sort_order: на курсе она после ЛД.
    expect(summaryGroupColumns(ctx.db).map((c) => c.id)).toEqual([first, second, contract, world.groupId, secondCourse])
  })

  it('запись подгруппы получает сторону и признак клинического деления', () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 1, pairNo: 1, weekParity: 'all', roomId: null })
    const [e] = templateEntriesView(ctx.db, tmpl.id as number)
    expect(e!.subgroupSide).toBeNull()
    expect(e!.isClinicalSubgroup).toBe(false)
    expect(e!.disciplineShortName).toBe(e!.disciplineName)
  })
})
