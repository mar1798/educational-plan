import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeRow, createRow, OptimisticLockError, updateRow } from '../../src/main/db/repo/base-repo'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('базовый репозиторий (§1.3, §1.4)', () => {
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

  it('createRow проставляет created_at/updated_at/row_version=1 и пишет change_log', () => {
    const row = createRow(
      ctx.db,
      schema.building,
      { name: 'Корпус 2' },
      { reason: 'тест' },
    )
    expect(row.rowVersion).toBe(1)
    expect(row.createdAt).toBeTruthy()
    expect(row.updatedAt).toBe(row.createdAt)

    const logs = ctx.db.select().from(schema.changeLog).where(eq(schema.changeLog.entity, 'building')).all()
    expect(logs).toHaveLength(1)
    expect(logs[0]!.action).toBe('create')
    expect(logs[0]!.reason).toBe('тест')
    expect(JSON.parse(logs[0]!.afterJson!)).toMatchObject({ name: 'Корпус 2' })
  })

  it('updateRow с верным row_version применяется и увеличивает версию', () => {
    const updated = updateRow(ctx.db, schema.teacher, world.teacherId, { phone: '0700000000' }, 1)
    expect(updated.rowVersion).toBe(2)
    expect(updated.phone).toBe('0700000000')

    const logs = ctx.db.select().from(schema.changeLog).where(eq(schema.changeLog.entity, 'teacher')).all()
    expect(logs).toHaveLength(1)
    expect(logs[0]!.action).toBe('update')
  })

  it('конкурентное сохранение с устаревшим row_version отклоняется', () => {
    updateRow(ctx.db, schema.teacher, world.teacherId, { phone: 'A' }, 1)
    // Второй «клиент» всё ещё думает, что row_version = 1.
    expect(() => updateRow(ctx.db, schema.teacher, world.teacherId, { phone: 'B' }, 1)).toThrow(OptimisticLockError)

    const current = ctx.db.select().from(schema.teacher).where(eq(schema.teacher.id, world.teacherId)).get()
    expect(current!.phone).toBe('A')
  })

  it('closeRow проставляет valid_to и пишет в change_log действие close (§4.1, §4.3)', () => {
    const closed = closeRow(ctx.db, schema.room, world.roomId, '2026-10-15', 1, { reason: 'кабинет закрыт' })
    expect(closed.validTo).toBe('2026-10-15')

    const logs = ctx.db.select().from(schema.changeLog).where(eq(schema.changeLog.entity, 'room')).all()
    expect(logs).toHaveLength(1)
    expect(logs[0]!.action).toBe('close')
  })
})
