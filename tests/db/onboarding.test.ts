import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { onboardingStatus } from '../../src/main/db/repo/onboarding'
import { ensurePairGrid } from '../../src/main/db/repo/pair-grid'
import { ensureTeacherCategories } from '../../src/main/db/repo/seed'
import { createTestDb, seedMinimalWorld } from './helpers'

describe('«С чего начать»: статус шагов по данным базы', () => {
  let ctx: ReturnType<typeof createTestDb>

  beforeEach(() => {
    ctx = createTestDb()
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('пустая база после первого запуска: всё к выполнению, звонки — проверить', () => {
    ensureTeacherCategories(ctx.db)
    ensurePairGrid(ctx.db)
    const status = onboardingStatus(ctx.db)
    expect(status.ready).toBe(false)
    const byKey = Object.fromEntries(status.steps.map((s) => [s.key, s.status]))
    expect(byKey).toEqual({
      calendar: 'todo',
      specialities: 'todo',
      disciplines: 'todo',
      groups: 'todo',
      teachers: 'todo',
      curricula: 'todo',
      qualifications: 'todo',
      load: 'todo',
      rooms: 'todo',
      pairGrid: 'review',
      schedule: 'todo',
    })
  })

  it('называет, чего не хватает: квалификаций у преподавателя, плана у группы', () => {
    seedMinimalWorld(ctx.db)
    const steps = Object.fromEntries(onboardingStatus(ctx.db).steps.map((s) => [s.key, s]))
    expect(steps.curricula!.status).toBe('done')
    expect(steps.qualifications).toMatchObject({ status: 'todo', issue: 'без квалификаций: Иванова Т, Петров С' })
    expect(steps.load!.status).toBe('done')
  })
})
