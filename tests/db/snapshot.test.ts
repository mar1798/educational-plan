import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTemplate, placeEntry } from '../../src/main/db/repo/schedule-template'
import { buildSolverInput } from '../../src/main/services/snapshot'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedCollegeWorld, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('services/snapshot.buildSolverInput (§5.5)', () => {
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

  it('считает units по формуле §5.2 из hoursPlanned/weeksCount', () => {
    // world.teachingLoadId: hoursPlanned=80, weeksCount по умолчанию 18 →
    // lessonsTotal=40, base=2 (parity 'all'), rest=4 → +1 юнит parity 'even' (rest<=evenWeeks=9).
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    const start = Date.now()
    const input = buildSolverInput(ctx.db, tmpl.id as number, 1)
    expect(Date.now() - start).toBeLessThan(1000)

    const mine = input.units.filter((u) => u.loadIdx === world.teachingLoadId)
    expect(mine).toHaveLength(3)
    expect(mine.filter((u) => u.parity === 'all')).toHaveLength(2)
    expect(mine.filter((u) => u.parity === 'even')).toHaveLength(1)
    expect(mine[0]!.teacherIdx).toBe(input.teachers.findIndex((t) => t.id === world.teacherId))
    expect(mine[0]!.students).toBe(25) // studentsCount группы из seedMinimalWorld
  })

  it('демо-колледж (39 групп, 390 строк нагрузки): снимок собирается меньше чем за секунду', () => {
    seedCollegeWorld(ctx.db, world)
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })

    const start = Date.now()
    const input = buildSolverInput(ctx.db, tmpl.id as number, 1)
    const elapsed = Date.now() - start

    expect(input.groups).toHaveLength(40) // 39 + группа из minimal-мира
    expect(input.units.length).toBeGreaterThan(300)
    expect(elapsed).toBeLessThan(1000)
  })

  it('уже стоящая (is_locked) запись становится fixed и уменьшает число units', () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    const created = placeEntry(ctx.db, {
      templateId: tmpl.id as number,
      teachingLoadId: world.teachingLoadId,
      dayOfWeek: 2,
      pairNo: 3,
      weekParity: 'all',
      roomId: world.roomId,
    })
    ctx.db.update(schema.templateEntry).set({ isLocked: true }).where(eq(schema.templateEntry.id, created.id as number)).run()

    const input = buildSolverInput(ctx.db, tmpl.id as number, 1)
    expect(input.fixed).toHaveLength(1)
    expect(input.fixed[0]!.slot).toBe((2 - 1) * 6 + (3 - 1))

    const mine = input.units.filter((u) => u.loadIdx === world.teachingLoadId)
    expect(mine).toHaveLength(2) // 3 нужных минус 1 уже закреплённый
  })

  it('индексы кабинетов/зданий/групп стабильны и соответствуют БД', () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    const input = buildSolverInput(ctx.db, tmpl.id as number, 1)
    expect(input.rooms.some((r) => r.id === world.roomId)).toBe(true)
    expect(input.rooms.some((r) => r.id === world.roomId2)).toBe(true)
    expect(input.groups.some((g) => g.id === world.groupId)).toBe(true)
  })
})
