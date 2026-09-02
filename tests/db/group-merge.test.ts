import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { updateRow } from '../../src/main/db/repo/base-repo'
import { countActiveGroupRefs, reassignActiveGroupRefs } from '../../src/main/db/repo/group-merge'
import { runOperation, undoOperation } from '../../src/main/db/repo/operations'
import { ensureDeletable, ReferencedError } from '../../src/main/db/repo/reference-guard'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('объединение групп (§2.4)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld
  let targetGroupId: number

  beforeEach(() => {
    ctx = createTestDb()
    world = seedMinimalWorld(ctx.db)
    targetGroupId = ctx.db
      .insert(schema.studyGroup)
      .values({
        name: '12 СД',
        specialityId: world.specialityId,
        admissionYear: 2026,
        course: 1,
        studentsCount: 20,
        funding: 'budget',
        validFrom: '2026-01-01',
      })
      .returning({ id: schema.studyGroup.id })
      .get().id
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('countActiveGroupRefs считает активную (validTo пусто) строку нагрузки, заведённую seedMinimalWorld', () => {
    const counts = countActiveGroupRefs(ctx.db, world.groupId, '2026-09-01')
    expect(counts.teachingLoad).toBe(1)
    expect(counts.streamMember).toBe(0)
  })

  it('не считает строку нагрузки, закрытую до даты объединения', () => {
    ctx.db.update(schema.teachingLoad).set({ validTo: '2026-06-01' }).where(eq(schema.teachingLoad.id, world.teachingLoadId)).run()
    const counts = countActiveGroupRefs(ctx.db, world.groupId, '2026-09-01')
    expect(counts.teachingLoad).toBe(0)
  })

  it('объединение переносит активную нагрузку и закрывает поглощённую группу, undo возвращает всё как было', () => {
    const { operationId } = runOperation(ctx.db, 'bulk_edit', {}, (tx, operationId) => {
      const source = tx.select().from(schema.studyGroup).where(eq(schema.studyGroup.id, world.groupId)).get()!
      const ctxArg = { operationId, reason: 'тест объединения' }
      reassignActiveGroupRefs(tx, world.groupId, targetGroupId, '2026-09-01', ctxArg)
      updateRow(tx, schema.studyGroup, world.groupId, { validTo: '2026-09-01', mergedIntoId: targetGroupId }, source.rowVersion, ctxArg, 'close')
    })

    const load = ctx.db.select().from(schema.teachingLoad).where(eq(schema.teachingLoad.id, world.teachingLoadId)).get()!
    expect(load.groupId).toBe(targetGroupId)

    const source = ctx.db.select().from(schema.studyGroup).where(eq(schema.studyGroup.id, world.groupId)).get()!
    expect(source.validTo).toBe('2026-09-01')
    expect(source.mergedIntoId).toBe(targetGroupId)

    undoOperation(ctx.db, operationId)

    const loadAfterUndo = ctx.db.select().from(schema.teachingLoad).where(eq(schema.teachingLoad.id, world.teachingLoadId)).get()!
    expect(loadAfterUndo.groupId).toBe(world.groupId)

    const sourceAfterUndo = ctx.db.select().from(schema.studyGroup).where(eq(schema.studyGroup.id, world.groupId)).get()!
    expect(sourceAfterUndo.validTo).toBeNull()
    expect(sourceAfterUndo.mergedIntoId).toBeNull()
  })

  it('блокирует удаление группы, поглотившей другую (ссылка через merged_into_id)', () => {
    ctx.db
      .update(schema.studyGroup)
      .set({ mergedIntoId: targetGroupId, validTo: '2026-09-01' })
      .where(eq(schema.studyGroup.id, world.groupId))
      .run()

    expect(() =>
      ensureDeletable(ctx.db, `Группа «12 СД»`, targetGroupId, [
        { table: schema.studyGroup, column: schema.studyGroup.mergedIntoId, nounRu: 'объединённых с ней группах' },
      ]),
    ).toThrow(ReferencedError)
  })
})
