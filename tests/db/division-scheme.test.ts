import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OptimisticLockError, updateRow } from '../../src/main/db/repo/base-repo'
import {
  clinicalPartsCount,
  computeEvenSplit,
  createDivisionScheme,
  ensureClinicalSchemes,
  SubgroupCoverageError,
  resetClinicalScheme,
  setDefaultDivisionScheme,
  syncGroupSchemes,
  syncSemesterSchemes,
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

describe('клинические подгруппы по численности (решение п. 44)', () => {
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

  function setStudents(n: number) {
    const g = ctx.db.select().from(schema.studyGroup).where(eq(schema.studyGroup.id, world.groupId)).get()!
    updateRow(ctx.db, schema.studyGroup, world.groupId, { studentsCount: n }, g.rowVersion)
    syncGroupSchemes(ctx.db, world.groupId)
  }

  function clinical() {
    const s = ctx.db.select().from(schema.divisionScheme).where(eq(schema.divisionScheme.groupId, world.groupId)).all().find((x) => x.clinicalSplit != null)
    if (!s) return null
    const subs = ctx.db.select().from(schema.subgroup).where(eq(schema.subgroup.schemeId, s.id)).all().sort((a, b) => a.no - b.no)
    return { ...s, bounds: subs.map((x) => [x.posFrom, x.posTo]) }
  }

  it('пороги: меньше 15 — вместе, 15–22 — на две, от 23 — на три', () => {
    expect([1, 14, 15, 22, 23, 30].map(clinicalPartsCount)).toEqual([1, 1, 2, 2, 3, 3])
  })

  it('заводит схему «Клинические» и пересчитывает её при смене численности', () => {
    syncGroupSchemes(ctx.db, world.groupId)
    expect(clinical()).toMatchObject({ name: 'Клинические', partsCount: 3, clinicalSplit: 'auto', isDefault: true })

    setStudents(20)
    expect(clinical()!.bounds).toEqual([
      [1, 10],
      [11, 20],
    ])

    setStudents(12)
    expect(clinical()).toBeNull()

    setStudents(16)
    expect(clinical()!.partsCount).toBe(2)
  })

  it('подгруппу из нагрузки не удаляет: число частей остаётся, сдвигаются границы', () => {
    syncGroupSchemes(ctx.db, world.groupId)
    const scheme = clinical()!
    const third = ctx.db.select().from(schema.subgroup).where(eq(schema.subgroup.schemeId, scheme.id)).all().find((s) => s.no === 3)!
    const load = ctx.db.select().from(schema.teachingLoad).where(eq(schema.teachingLoad.id, world.teachingLoadId)).get()!
    updateRow(ctx.db, schema.teachingLoad, load.id, { divisionSchemeId: scheme.id, subgroupId: third.id }, load.rowVersion)

    setStudents(20)
    expect(clinical()!.partsCount).toBe(3)
    expect(clinical()!.bounds).toEqual([
      [1, 7],
      [8, 14],
      [15, 20],
    ])
  })

  it('ручная правка замораживает схему, «пересчитать» возвращает деление по порогам', () => {
    syncGroupSchemes(ctx.db, world.groupId)
    const scheme = createdClinical()
    const [a, b, c] = scheme.subgroups
    updateSubgroupBounds(ctx.db, scheme.id, [
      { subgroupId: a!.id, rowVersion: a!.rowVersion, posFrom: 1, posTo: 8 },
      { subgroupId: b!.id, rowVersion: b!.rowVersion, posFrom: 9, posTo: 16 },
      { subgroupId: c!.id, rowVersion: c!.rowVersion, posFrom: 17, posTo: 25 },
    ])
    expect(clinical()!.clinicalSplit).toBe('manual')

    // Пришли двое: ручные границы сохраняются, дотягивается только последняя подгруппа.
    setStudents(27)
    expect(clinical()!.bounds).toEqual([
      [1, 8],
      [9, 16],
      [17, 27],
    ])

    resetClinicalScheme(ctx.db, scheme.id)
    expect(clinical()).toMatchObject({ clinicalSplit: 'auto', bounds: [[1, 9], [10, 18], [19, 27]] })
  })

  it('обычную схему после сокращения группы делит заново, чтобы покрытие 1..N не ломалось', () => {
    const manual = createDivisionScheme(ctx.db, { groupId: world.groupId, semesterId: world.semesterId, name: 'Лаб', partsCount: 2, isDefault: false })
    setStudents(10)
    const subs = ctx.db.select().from(schema.subgroup).where(eq(schema.subgroup.schemeId, manual.id)).all()
    expect(() => validateCoverage(subs, 10)).not.toThrow()
  })

  it('новый семестр получает клинические схемы всех действующих групп', () => {
    const springId = ctx.db
      .insert(schema.semester)
      .values({ academicYearId: world.academicYearId, no: 2, startsOn: '2027-02-01', endsOn: '2027-06-30' })
      .returning({ id: schema.semester.id })
      .get().id
    syncSemesterSchemes(ctx.db, springId)
    const schemes = ctx.db.select().from(schema.divisionScheme).where(eq(schema.divisionScheme.semesterId, springId)).all()
    expect(schemes).toHaveLength(1)
    expect(schemes[0]).toMatchObject({ groupId: world.groupId, partsCount: 3, clinicalSplit: 'auto' })
  })

  function createdClinical() {
    const s = clinical()!
    return { ...s, subgroups: ctx.db.select().from(schema.subgroup).where(eq(schema.subgroup.schemeId, s.id)).all().sort((x, y) => x.no - y.no) }
  }
})

describe('разовое заполнение клинических схем для старой базы (п. 44)', () => {
  it('заводит схемы одной операцией и второй раз ничего не делает', () => {
    const ctx = createTestDb()
    const world = seedMinimalWorld(ctx.db)
    ensureClinicalSchemes(ctx.db)
    ensureClinicalSchemes(ctx.db)
    const schemes = ctx.db.select().from(schema.divisionScheme).where(eq(schema.divisionScheme.groupId, world.groupId)).all()
    expect(schemes).toHaveLength(1)
    expect(schemes[0]!.clinicalSplit).toBe('auto')
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })
})
