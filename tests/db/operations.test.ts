import { asc, eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRow, updateRow } from '../../src/main/db/repo/base-repo'
import { OperationNotUndoableError, runOperation, undoOperation } from '../../src/main/db/repo/operations'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld } from './helpers'

describe('операции и откат (§1.5)', () => {
  let ctx: ReturnType<typeof createTestDb>

  beforeEach(() => {
    ctx = createTestDb()
    seedMinimalWorld(ctx.db)
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  function dumpTeachers() {
    return ctx.db.select().from(schema.teacher).orderBy(asc(schema.teacher.id)).all()
  }

  it('массовое изменение 100 строк, затем откат — состояние совпадает с исходным', () => {
    const teacherCategoryId = ctx.db.select().from(schema.teacherCategory).get()!.id
    const ids: number[] = []
    for (let i = 0; i < 100; i++) {
      const row = createRow(ctx.db, schema.teacher, {
        lastName: `Тестова${i}`,
        firstName: 'Т',
        categoryId: teacherCategoryId,
      })
      ids.push(row.id as number)
    }

    const before = dumpTeachers()

    const { operationId } = runOperation(ctx.db, 'bulk_edit', { note: 'массовая правка' }, (tx, opId) => {
      for (const id of ids) {
        updateRow(tx, schema.teacher, id, { note: 'массовая правка' }, 1, { operationId: opId, reason: 'тест' })
      }
    })

    const afterEdit = dumpTeachers()
    expect(afterEdit.filter((t) => t.note === 'массовая правка')).toHaveLength(100)

    undoOperation(ctx.db, operationId)

    const afterUndo = dumpTeachers()
    expect(afterUndo).toEqual(before)
  })

  it('undo() физически удаляет строки, которые операция создала', () => {
    const { operationId } = runOperation(ctx.db, 'import', {}, (tx, opId) => {
      createRow(tx, schema.building, { name: 'Временный корпус' }, { operationId: opId })
    })

    expect(ctx.db.select().from(schema.building).where(eq(schema.building.name, 'Временный корпус')).all()).toHaveLength(1)

    undoOperation(ctx.db, operationId)

    expect(ctx.db.select().from(schema.building).where(eq(schema.building.name, 'Временный корпус')).all()).toHaveLength(0)
  })

  it('повторный undo той же операции отклоняется', () => {
    const { operationId } = runOperation(ctx.db, 'bulk_edit', {}, (tx, opId) => {
      createRow(tx, schema.building, { name: 'X' }, { operationId: opId })
    })
    undoOperation(ctx.db, operationId)
    expect(() => undoOperation(ctx.db, operationId)).toThrow(OperationNotUndoableError)
  })
})
