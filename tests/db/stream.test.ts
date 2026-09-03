import { eq, isNull } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStream, disbandStream, listStreamsWithMembers, StreamValidationError } from '../../src/main/db/repo/stream'
import { NotFoundError } from '../../src/main/db/repo/base-repo'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('потоки: создание, состав, расформирование (§3.5a)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld
  let groupId2: number

  beforeEach(() => {
    ctx = createTestDb()
    world = seedMinimalWorld(ctx.db)
    groupId2 = ctx.db
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

  it('создаёт поток из групп одной специальности и курса', () => {
    const s = createStream(ctx.db, { semesterId: world.semesterId, name: 'Поток СД-1', groupIds: [world.groupId, groupId2], validFrom: '2026-09-01' })
    expect(s.members).toHaveLength(2)
    expect(s.members.map((m) => m.groupId).sort()).toEqual([world.groupId, groupId2].sort())
  })

  it('отклоняет поток менее чем из 2 групп', () => {
    expect(() => createStream(ctx.db, { semesterId: world.semesterId, name: 'Поток', groupIds: [world.groupId], validFrom: '2026-09-01' })).toThrow(
      StreamValidationError,
    )
  })

  it('отклоняет группу другого курса', () => {
    const otherCourseGroupId = ctx.db
      .insert(schema.studyGroup)
      .values({ name: 'СД-31', specialityId: world.specialityId, admissionYear: 2024, course: 3, studentsCount: 20, funding: 'budget', validFrom: '2026-01-01' })
      .returning({ id: schema.studyGroup.id })
      .get().id

    expect(() =>
      createStream(ctx.db, { semesterId: world.semesterId, name: 'Поток', groupIds: [world.groupId, otherCourseGroupId], validFrom: '2026-09-01' }),
    ).toThrow(StreamValidationError)
  })

  it('расформирование распадается на группы с теми же часами каждая, поток удаляется', () => {
    const s = createStream(ctx.db, { semesterId: world.semesterId, name: 'Поток СД-1', groupIds: [world.groupId, groupId2], validFrom: '2026-09-01' })
    ctx.db
      .insert(schema.teachingLoad)
      .values({
        semesterId: world.semesterId,
        curriculumRowId: world.curriculumRowId,
        teacherId: world.teacherId,
        streamId: s.id,
        lessonKind: 'theory',
        hoursPlanned: 6,
        validFrom: '2026-09-01',
      })
      .run()

    const { createdLoadIds } = disbandStream(ctx.db, s.id)
    expect(createdLoadIds).toHaveLength(2)

    const created = ctx.db.select().from(schema.teachingLoad).where(isNull(schema.teachingLoad.streamId)).all()
    const forThisTeacher = created.filter((r) => r.teacherId === world.teacherId && r.hoursPlanned === 6)
    expect(forThisTeacher.map((r) => r.groupId).sort()).toEqual([world.groupId, groupId2].sort())

    expect(listStreamsWithMembers(ctx.db, world.semesterId).find((x) => x.id === s.id)).toBeUndefined()
    const streamRow = ctx.db.select().from(schema.stream).where(eq(schema.stream.id, s.id)).get()
    expect(streamRow).toBeUndefined()
  })

  it('падает NotFoundError при расформировании несуществующего потока', () => {
    expect(() => disbandStream(ctx.db, 999999)).toThrow(NotFoundError)
  })
})
