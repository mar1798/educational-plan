import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OptimisticLockError } from '../../src/main/db/repo/base-repo'
import {
  computeEvenSplit,
  createDivisionScheme,
  SubgroupCoverageError,
  setDefaultDivisionScheme,
  updateSubgroupBounds,
  validateCoverage,
} from '../../src/main/db/repo/division-scheme'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('автоматический расчёт границ (§2.5, §4.6)', () => {
  it('делит 25 студентов на 2 подгруппы почти поровну, остаток — в первую', () => {
    expect(computeEvenSplit(25, 2)).toEqual([
      { no: 1, posFrom: 1, posTo: 13 },
      { no: 2, posFrom: 14, posTo: 25 },
    ])
  })

  it('делит 25 студентов на 3 подгруппы', () => {
    expect(computeEvenSplit(25, 3)).toEqual([
      { no: 1, posFrom: 1, posTo: 9 },
      { no: 2, posFrom: 10, posTo: 17 },
      { no: 3, posFrom: 18, posTo: 25 },
    ])
  })

  it('делит без остатка ровно', () => {
    expect(computeEvenSplit(30, 3)).toEqual([
      { no: 1, posFrom: 1, posTo: 10 },
      { no: 2, posFrom: 11, posTo: 20 },
      { no: 3, posFrom: 21, posTo: 30 },
    ])
  })
})

describe('проверка покрытия 1..N без пропусков и наложений (§2.5)', () => {
  it('пропускает корректное покрытие', () => {
    expect(() => validateCoverage([{ posFrom: 1, posTo: 13 }, { posFrom: 14, posTo: 25 }], 25)).not.toThrow()
  })

  it('блокирует при пропуске между отрезками', () => {
    expect(() => validateCoverage([{ posFrom: 1, posTo: 10 }, { posFrom: 15, posTo: 25 }], 25)).toThrow(SubgroupCoverageError)
  })

  it('блокирует при наложении отрезков', () => {
    expect(() => validateCoverage([{ posFrom: 1, posTo: 15 }, { posFrom: 10, posTo: 25 }], 25)).toThrow(SubgroupCoverageError)
  })

  it('блокирует, если отрезки не доходят до конца списка', () => {
    expect(() => validateCoverage([{ posFrom: 1, posTo: 13 }, { posFrom: 14, posTo: 20 }], 25)).toThrow(SubgroupCoverageError)
  })

  it('блокирует отрезок с началом больше конца', () => {
    expect(() => validateCoverage([{ posFrom: 10, posTo: 5 }], 25)).toThrow(SubgroupCoverageError)
  })
})

describe('схемы деления на подгруппы: создание и правка границ (§2.5)', () => {
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

  it('создаёт схему «на 2» с автоматически рассчитанными границами (группа на 25 студентов)', () => {
    const scheme = createDivisionScheme(ctx.db, {
      groupId: world.groupId,
      semesterId: world.semesterId,
      name: 'Клинические дисциплины',
      partsCount: 2,
      isDefault: false,
    })
    expect(scheme.partsCount).toBe(2)
    expect(scheme.subgroups).toHaveLength(2)
    expect(scheme.subgroups.map((s) => [s.posFrom, s.posTo])).toEqual([
      [1, 13],
      [14, 25],
    ])
  })

  it('только одна схема группы может быть основной одновременно', () => {
    const first = createDivisionScheme(ctx.db, {
      groupId: world.groupId,
      semesterId: world.semesterId,
      name: 'На 2',
      partsCount: 2,
      isDefault: true,
    })
    const second = createDivisionScheme(ctx.db, {
      groupId: world.groupId,
      semesterId: world.semesterId,
      name: 'На 3',
      partsCount: 3,
      isDefault: true,
    })
    expect(second.isDefault).toBe(true)
    const firstAfterSecond = ctx.db.select().from(schema.divisionScheme).where(eq(schema.divisionScheme.id, first.id)).get()!
    expect(firstAfterSecond.isDefault).toBe(false)

    setDefaultDivisionScheme(ctx.db, first.id)
    const firstAfterSetDefault = ctx.db.select().from(schema.divisionScheme).where(eq(schema.divisionScheme.id, first.id)).get()!
    const secondAfterSetDefault = ctx.db.select().from(schema.divisionScheme).where(eq(schema.divisionScheme.id, second.id)).get()!
    expect(firstAfterSetDefault.isDefault).toBe(true)
    expect(secondAfterSetDefault.isDefault).toBe(false)
  })

  it('основная схема считается отдельно по семестрам: схема другого семестра не сбрасывается', () => {
    const autumn = createDivisionScheme(ctx.db, {
      groupId: world.groupId,
      semesterId: world.semesterId,
      name: 'Осень, на 2',
      partsCount: 2,
      isDefault: true,
    })
    const springSemesterId = ctx.db
      .insert(schema.semester)
      .values({ academicYearId: world.academicYearId, no: 2, startsOn: '2027-02-01', endsOn: '2027-06-30' })
      .returning({ id: schema.semester.id })
      .get().id

    const spring = createDivisionScheme(ctx.db, {
      groupId: world.groupId,
      semesterId: springSemesterId,
      name: 'Весна, на 3',
      partsCount: 3,
      isDefault: true,
    })

    const autumnAfter = ctx.db.select().from(schema.divisionScheme).where(eq(schema.divisionScheme.id, autumn.id)).get()!
    expect(autumnAfter.isDefault).toBe(true)
    expect(spring.isDefault).toBe(true)

    setDefaultDivisionScheme(ctx.db, spring.id)
    const autumnAfterSetDefault = ctx.db
      .select()
      .from(schema.divisionScheme)
      .where(eq(schema.divisionScheme.id, autumn.id))
      .get()!
    expect(autumnAfterSetDefault.isDefault).toBe(true)
  })

  it('блокирует деление, если студентов меньше, чем подгрупп', () => {
    const tinyGroupId = ctx.db
      .insert(schema.studyGroup)
      .values({
        name: '12 СД',
        specialityId: world.specialityId,
        admissionYear: 2026,
        course: 1,
        studentsCount: 2,
        funding: 'budget',
        validFrom: '2026-01-01',
      })
      .returning({ id: schema.studyGroup.id })
      .get().id

    expect(() =>
      createDivisionScheme(ctx.db, { groupId: tinyGroupId, semesterId: world.semesterId, name: 'На 3', partsCount: 3, isDefault: false }),
    ).toThrow(SubgroupCoverageError)
  })

  it('правка границ проходит при корректном покрытии и блокируется при разрыве', () => {
    const scheme = createDivisionScheme(ctx.db, {
      groupId: world.groupId,
      semesterId: world.semesterId,
      name: 'На 2',
      partsCount: 2,
      isDefault: false,
    })
    const [sub1, sub2] = scheme.subgroups
    if (!sub1 || !sub2) throw new Error('expected 2 subgroups')

    const updated = updateSubgroupBounds(ctx.db, scheme.id, [
      { subgroupId: sub1.id, rowVersion: sub1.rowVersion, posFrom: 1, posTo: 15 },
      { subgroupId: sub2.id, rowVersion: sub2.rowVersion, posFrom: 16, posTo: 25 },
    ])
    expect(updated.subgroups.map((s) => [s.posFrom, s.posTo])).toEqual([
      [1, 15],
      [16, 25],
    ])

    expect(() =>
      updateSubgroupBounds(ctx.db, scheme.id, [
        { subgroupId: sub1.id, rowVersion: sub1.rowVersion + 1, posFrom: 1, posTo: 10 },
        { subgroupId: sub2.id, rowVersion: sub2.rowVersion + 1, posFrom: 16, posTo: 25 },
      ]),
    ).toThrow(/Пропуск/)
  })

  it('оптимистичная блокировка: устаревшая версия строки блокирует правку границ', () => {
    const scheme = createDivisionScheme(ctx.db, {
      groupId: world.groupId,
      semesterId: world.semesterId,
      name: 'На 2',
      partsCount: 2,
      isDefault: false,
    })
    const [sub1, sub2] = scheme.subgroups
    if (!sub1 || !sub2) throw new Error('expected 2 subgroups')
    expect(() =>
      updateSubgroupBounds(ctx.db, scheme.id, [
        { subgroupId: sub1.id, rowVersion: 999, posFrom: 1, posTo: 13 },
        { subgroupId: sub2.id, rowVersion: sub2.rowVersion, posFrom: 14, posTo: 25 },
      ]),
    ).toThrow(OptimisticLockError)
  })
})
