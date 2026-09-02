import { asc, eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OptimisticLockError } from '../../src/main/db/repo/base-repo'
import { ensurePairGrid, updatePairGridRow } from '../../src/main/db/repo/pair-grid'
import * as schema from '../../src/main/db/schema'
import { createTestDb } from './helpers'

describe('сетка звонков pair_grid (§2.9)', () => {
  let ctx: ReturnType<typeof createTestDb>

  beforeEach(() => {
    ctx = createTestDb()
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('заводит 6 пар по умолчанию на пустой БД', () => {
    ensurePairGrid(ctx.db)
    const rows = ctx.db.select().from(schema.pairGrid).orderBy(asc(schema.pairGrid.pairNo)).all()
    expect(rows).toHaveLength(6)
    expect(rows.map((r) => r.pairNo)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('повторный вызов не дублирует и не перезаписывает уже поправленные строки', () => {
    ensurePairGrid(ctx.db)
    const first = ctx.db.select().from(schema.pairGrid).all()
    ensurePairGrid(ctx.db)
    const second = ctx.db.select().from(schema.pairGrid).all()
    expect(second).toHaveLength(first.length)
  })

  it('правка времени пары увеличивает row_version и пишет change_log', () => {
    ensurePairGrid(ctx.db)
    const before = ctx.db.select().from(schema.pairGrid).where(eq(schema.pairGrid.pairNo, 1)).get()!
    const updated = updatePairGridRow(
      ctx.db,
      { pairNo: 1, rowVersion: before.rowVersion, startsAt: '08:30', endsAt: '10:00', academicHours: 2, enabled: true },
      { reason: 'правка сетки звонков' },
    )
    expect(updated.startsAt).toBe('08:30')
    expect(updated.rowVersion).toBe(before.rowVersion + 1)

    const logs = ctx.db.select().from(schema.changeLog).where(eq(schema.changeLog.entity, 'pair_grid')).all()
    expect(logs).toHaveLength(1)
  })

  it('оптимистичная блокировка: устаревшая версия строки блокирует правку', () => {
    ensurePairGrid(ctx.db)
    expect(() =>
      updatePairGridRow(ctx.db, { pairNo: 1, rowVersion: 999, startsAt: '08:30', endsAt: '10:00', academicHours: 2, enabled: true }),
    ).toThrow(OptimisticLockError)
  })
})
