import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteRow } from '../../src/main/db/repo/base-repo'
import { runOperation, undoOperation } from '../../src/main/db/repo/operations'
import { ensureDeletable, ReferencedError } from '../../src/main/db/repo/reference-guard'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('ensureDeletable (§2.2)', () => {
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

  it('блокирует удаление корпуса, у которого есть кабинеты, с точным числом', () => {
    expect(() =>
      ensureDeletable(ctx.db, `Корпус «Главный»`, world.buildingId, [
        { table: schema.room, column: schema.room.buildingId, nounRu: 'кабинетах' },
      ]),
    ).toThrow(ReferencedError)

    try {
      ensureDeletable(ctx.db, `Корпус «Главный»`, world.buildingId, [
        { table: schema.room, column: schema.room.buildingId, nounRu: 'кабинетах' },
      ])
    } catch (e) {
      expect((e as Error).message).toBe('Нельзя удалить Корпус «Главный»: используется в 2 кабинетах')
    }
  })

  it('пропускает удаление, если ссылок нет', () => {
    expect(() =>
      ensureDeletable(ctx.db, 'ЦМК «Тест»', 999_999, [
        { table: schema.teacher, column: schema.teacher.cmcId, nounRu: 'преподавателях' },
      ]),
    ).not.toThrow()
  })

  it('deleteRow физически удаляет строку и пишет change_log action=delete', () => {
    const buildingId = ctx.db
      .insert(schema.building)
      .values({ name: 'Корпус на снос' })
      .returning({ id: schema.building.id })
      .get().id

    deleteRow(ctx.db, schema.building, buildingId, { reason: 'тест' })

    const gone = ctx.db.select().from(schema.building).where(eq(schema.building.id, buildingId)).get()
    expect(gone).toBeUndefined()

    const logs = ctx.db
      .select()
      .from(schema.changeLog)
      .where(eq(schema.changeLog.entityId, buildingId))
      .all()
      .filter((l) => l.entity === 'building')
    expect(logs).toHaveLength(1)
    expect(logs[0]!.action).toBe('delete')
    expect(logs[0]!.afterJson).toBeNull()
    expect(JSON.parse(logs[0]!.beforeJson!)).toMatchObject({ name: 'Корпус на снос' })
  })

  it('undoOperation восстанавливает физически удалённую строку', () => {
    const { operationId, result: buildingId } = runOperation(ctx.db, 'bulk_edit', {}, (tx, operationId) => {
      const created = tx
        .insert(schema.building)
        .values({ name: 'Временный корпус' })
        .returning({ id: schema.building.id })
        .get()
      deleteRow(tx, schema.building, created.id, { operationId })
      return created.id
    })

    expect(ctx.db.select().from(schema.building).where(eq(schema.building.id, buildingId)).get()).toBeUndefined()

    undoOperation(ctx.db, operationId)

    const restored = ctx.db.select().from(schema.building).where(eq(schema.building.id, buildingId)).get()
    expect(restored?.name).toBe('Временный корпус')
  })
})
