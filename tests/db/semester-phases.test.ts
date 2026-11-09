import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { solveGreedy } from '../../src/solver/greedy'
import { validateSolution } from '../../src/solver/validate'
import { undoOperation } from '../../src/main/db/repo/operations'
import { createTemplate, planRollout, templateEntriesView } from '../../src/main/db/repo/schedule-template'
import { applyPhases } from '../../src/main/services/apply-solution'
import { applyPreferredSlots } from '../../src/main/services/phase-stability'
import { semesterPhases } from '../../src/main/services/semester-phases'
import { buildSolverInput } from '../../src/main/services/snapshot'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('фазы семестра и генерация по фазам (этап Д)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld
  let practiceId: number

  beforeEach(() => {
    ctx = createTestDb()
    world = seedMinimalWorld(ctx.db)
    // Теория 36 ч в неделях 1–5 по 8 ч/нед, практика 30 ч с 4-й недели. Начало практики задано
    // руками: без него правило «сначала лекции» (решение 53) сдвинуло бы её на 6-ю, а здесь
    // проверяется механика фаз на перекрытии лекций и практики.
    ctx.db.update(schema.teachingLoad).set({ lessonKind: 'theory', hoursPlanned: 36, hoursPerWeek: 8 }).where(eq(schema.teachingLoad.id, world.teachingLoadId)).run()
    practiceId = ctx.db
      .insert(schema.teachingLoad)
      .values({ semesterId: world.semesterId, curriculumRowId: world.curriculumRowId, teacherId: world.teacherId2, groupId: world.groupId, lessonKind: 'practice', hoursPlanned: 30, weekFrom: 4, validFrom: '2026-09-01' })
      .returning({ id: schema.teachingLoad.id })
      .get().id
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('границы фаз: нед. 1–3 лекции, 4–5 лекции и практика, 6–18 практика; склейка помечает недели из одной недели', () => {
    const { phases, problems } = semesterPhases(ctx.db, world.semesterId)
    expect(problems).toEqual([])
    expect(phases.map((p) => [p.weekFrom, p.weekTo])).toEqual([[1, 3], [4, 5], [6, 18]])
    expect(phases[0]!.loads.map((l) => l.loadId)).toEqual([world.teachingLoadId])
    expect(phases[1]!.loads).toHaveLength(2)
    expect(phases[2]!.loads.map((l) => l.loadId)).toEqual([practiceId])
    expect(phases[1]!.startedBy[0]).toContain('практика')
    expect(phases[2]!.startedBy[0]).toContain('заканчивается')
    expect(phases.every((p) => !p.short)).toBe(true)

    ctx.db.update(schema.teachingLoad).set({ weekTo: 4, hoursPerWeek: 9 }).where(eq(schema.teachingLoad.id, world.teachingLoadId)).run()
    const merged = semesterPhases(ctx.db, world.semesterId).phases
    expect(merged.map((p) => [p.weekFrom, p.weekTo])).toEqual([[1, 3], [4, 4], [5, 18]])
    expect(merged[1]!.short).toBe(true)
  })

  it('первая фаза вступает в силу не раньше начала семестра, следующие — с понедельника своей недели', () => {
    const { phases } = semesterPhases(ctx.db, world.semesterId)
    expect(phases[0]!.effectiveFrom).toBe('2026-09-01')
    expect(phases[1]!.effectiveFrom).toBe('2026-09-21') // нед. 4: Пн 21.09
  })

  it('снимок фазы 1 не содержит практики; фазы 2 — содержит обе нагрузки; неверные недели строку выкидывают', () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    const phase1 = buildSolverInput(ctx.db, tmpl.id as number, 1, { from: 1, to: 3 })
    expect(new Set(phase1.units.map((u) => u.loadIdx))).toEqual(new Set([world.teachingLoadId]))
    // 8 ч/нед, пара 2 ч → 4 занятия в неделю
    expect(phase1.units).toHaveLength(4)

    const phase2 = buildSolverInput(ctx.db, tmpl.id as number, 1, { from: 4, to: 5 })
    expect(new Set(phase2.units.map((u) => u.loadIdx))).toEqual(new Set([world.teachingLoadId, practiceId]))

    const phase3 = buildSolverInput(ctx.db, tmpl.id as number, 1, { from: 6, to: 18 })
    expect(new Set(phase3.units.map((u) => u.loadIdx))).toEqual(new Set([practiceId]))
    // практика 30 ч на 15 недель (нед. 4–18) → 1 занятие в неделю
    expect(phase3.units).toHaveLength(1)

    // Без weekRange снимок прежний — на весь семестр.
    expect(new Set(buildSolverInput(ctx.db, tmpl.id as number, 1).units.map((u) => u.loadIdx))).toEqual(new Set([world.teachingLoadId, practiceId]))
  })

  it('слоты продолжающейся нагрузки переносятся в следующую фазу как предпочтительные', () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    const input1 = buildSolverInput(ctx.db, tmpl.id as number, 1, { from: 1, to: 3 })
    const output1 = solveGreedy(input1)
    const input2 = buildSolverInput(ctx.db, tmpl.id as number, 1, { from: 4, to: 5 })
    const matched = applyPreferredSlots(input2, { input: input1, output: output1 })

    expect(matched).toBe(4)
    const lectureUnits = input2.units.filter((u) => u.loadIdx === world.teachingLoadId)
    expect(lectureUnits.map((u) => u.preferredSlot).sort()).toEqual(output1.assignments.map((a) => a.slot).sort())
    expect(input2.units.filter((u) => u.loadIdx === practiceId).every((u) => u.preferredSlot == null)).toBe(true)

    // Жадная расстановка фазы 2 оставляет лекции на прежних местах.
    const output2 = solveGreedy(input2)
    expect(validateSolution(input2, output2)).toEqual([])
    const slotsOf = (i: typeof input2, o: typeof output2) => o.assignments.filter((a) => i.units.find((u) => u.id === a.unitId)!.loadIdx === world.teachingLoadId).map((a) => a.slot).sort()
    expect(slotsOf(input2, output2)).toEqual(output1.assignments.map((a) => a.slot).sort())
  })

  it('интеграция: версии фаз вступают в силу по датам, практики нет в версии фазы 1, откат убирает все версии', () => {
    const source = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    const { phases } = semesterPhases(ctx.db, world.semesterId)
    const runs = phases.map((p) => {
      const input = buildSolverInput(ctx.db, source.id as number, 1, { from: p.weekFrom, to: p.weekTo })
      const output = solveGreedy(input)
      expect(validateSolution(input, output)).toEqual([])
      return { draft: { input, output }, options: { effectiveFrom: p.effectiveFrom, note: `Фаза ${p.no}`, activeLoadIds: new Set(p.loads.map((l) => l.loadId)) } }
    })

    const before = ctx.db.select().from(schema.scheduleTemplate).all().length
    const result = applyPhases(ctx.db, source.id as number, runs)
    expect(result.templateIds).toHaveLength(3)

    const loadsOf = (templateId: number) => new Set(templateEntriesView(ctx.db, templateId).map((e) => e.teachingLoadId))
    expect(loadsOf(result.templateIds[0]!)).toEqual(new Set([world.teachingLoadId]))
    expect(loadsOf(result.templateIds[2]!)).toEqual(new Set([practiceId]))
    const versions = ctx.db.select().from(schema.scheduleTemplate).all().filter((t) => result.templateIds.includes(t.id))
    expect(versions.map((v) => v.effectiveFrom).sort()).toEqual(['2026-09-01', '2026-09-21', '2026-10-05'])

    undoOperation(ctx.db, result.operationId)
    expect(ctx.db.select().from(schema.scheduleTemplate).all().length).toBe(before)
  })

  it('раскатка не материализует занятие за пределами недель действия нагрузки', () => {
    const source = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    // Практика стоит в версии, но по неделям идёт с 4-й: на 1-й неделе занятий быть не должно.
    ctx.db.insert(schema.templateEntry).values({ templateId: source.id as number, dayOfWeek: 2, pairNo: 1, teachingLoadId: practiceId, roomId: null, weekParity: 'all', isLocked: false, source: 'manual' }).run()
    const plan = planRollout(ctx.db, { templateId: source.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-30' })
    const dates = plan.items.filter((i) => i.action === 'create').map((i) => i.date)
    expect(dates).not.toContain('2026-09-01') // вт нед. 1
    expect(dates).not.toContain('2026-09-08') // вт нед. 2
    expect(dates).not.toContain('2026-09-15') // вт нед. 3
    expect(dates).toContain('2026-09-22') // вт нед. 4
  })

  it('раскатка не материализует занятие после последней недели действия нагрузки', () => {
    const source = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    // Лекции 36 ч по 8 ч/нед идут нед. 1–5 (вычисленная week_to = 5): на 6-й неделе их быть не должно.
    ctx.db.insert(schema.templateEntry).values({ templateId: source.id as number, dayOfWeek: 2, pairNo: 1, teachingLoadId: world.teachingLoadId, roomId: null, weekParity: 'all', isLocked: false, source: 'manual' }).run()
    const plan = planRollout(ctx.db, { templateId: source.id as number, dateFrom: '2026-09-01', dateTo: '2026-10-31' })
    const dates = plan.items.filter((i) => i.action === 'create').map((i) => i.date)
    expect(dates).toContain('2026-09-29') // вт нед. 5
    expect(dates).not.toContain('2026-10-06') // вт нед. 6
    expect(dates).not.toContain('2026-10-27') // вт нед. 9
  })

  it('версия фазы действует только до начала следующей: раскатка обрезается по effective_to', () => {
    const source = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    ctx.db.insert(schema.templateEntry).values({ templateId: source.id as number, dayOfWeek: 2, pairNo: 1, teachingLoadId: world.teachingLoadId, roomId: null, weekParity: 'all', isLocked: false, source: 'manual' }).run()
    ctx.db.update(schema.scheduleTemplate).set({ effectiveTo: '2026-09-13' }).where(eq(schema.scheduleTemplate.id, source.id as number)).run()
    const plan = planRollout(ctx.db, { templateId: source.id as number, dateFrom: '2026-09-01', dateTo: '2026-10-31' })
    expect(plan.dateTo).toBe('2026-09-13')
  })
})
