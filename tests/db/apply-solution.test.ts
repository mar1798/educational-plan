import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { solveGreedy } from '../../src/solver/greedy'
import { validateSolution } from '../../src/solver/validate'
import { createTemplate, placeEntry, templateEntriesView } from '../../src/main/db/repo/schedule-template'
import { undoOperation } from '../../src/main/db/repo/operations'
import { applySolution } from '../../src/main/services/apply-solution'
import { buildSolverInput } from '../../src/main/services/snapshot'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('services/apply-solution.applySolution (§5.9)', () => {
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

  it('создаёт новую версию шаблона с локальными и сгенерированными записями; откат возвращает как было', () => {
    const source = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    const locked = placeEntry(ctx.db, {
      templateId: source.id as number,
      teachingLoadId: world.teachingLoadId,
      dayOfWeek: 2,
      pairNo: 1,
      weekParity: 'all',
      roomId: world.roomId,
    })
    ctx.db.update(schema.templateEntry).set({ isLocked: true }).where(eq(schema.templateEntry.id, locked.id as number)).run()

    const input = buildSolverInput(ctx.db, source.id as number, 7)
    const output = solveGreedy(input)
    expect(validateSolution(input, output)).toEqual([])
    expect(output.unplaced).toHaveLength(0)

    const templatesBefore = ctx.db.select().from(schema.scheduleTemplate).all().length

    const result = applySolution(ctx.db, source.id as number, { input, output })
    expect(result.created).toBe(output.assignments.length)

    const entries = templateEntriesView(ctx.db, result.templateId)
    // locked-запись перенесена + все размещения солвера.
    expect(entries).toHaveLength(1 + output.assignments.length)
    expect(entries.some((e) => e.isLocked)).toBe(true)
    expect(entries.some((e) => e.source === 'solver')).toBe(true)

    const templatesAfterApply = ctx.db.select().from(schema.scheduleTemplate).all().length
    expect(templatesAfterApply).toBe(templatesBefore + 1)

    undoOperation(ctx.db, result.operationId)

    const templatesAfterUndo = ctx.db.select().from(schema.scheduleTemplate).all().length
    expect(templatesAfterUndo).toBe(templatesBefore)
    // исходный шаблон и его locked-запись не тронуты.
    expect(templateEntriesView(ctx.db, source.id as number)).toHaveLength(1)
  })
})
