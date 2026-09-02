import { and, asc, eq } from 'drizzle-orm'
import { divisionScheme, studyGroup, subgroup } from '../schema/people'
import type { AuditContext } from './audit'
import { createRow, NotFoundError, updateRow } from './base-repo'
import type { DbLike } from './types'

export class SubgroupCoverageError extends Error {}

/**
 * Автоматический расчёт границ (§2.5, §4.6): группа из N студентов делится на
 * partsCount почти равных отрезков подряд, остаток распределяется по первым подгруппам.
 */
export function computeEvenSplit(studentsCount: number, partsCount: number): { no: number; posFrom: number; posTo: number }[] {
  const base = Math.floor(studentsCount / partsCount)
  const remainder = studentsCount % partsCount
  const parts: { no: number; posFrom: number; posTo: number }[] = []
  let pos = 1
  for (let no = 1; no <= partsCount; no++) {
    const size = base + (no <= remainder ? 1 : 0)
    parts.push({ no, posFrom: pos, posTo: pos + size - 1 })
    pos += size
  }
  return parts
}

/**
 * Проверка покрытия 1..N без пропусков и наложений (§2.5) — иначе сохранение границ
 * блокируется. Отрезки сортируются по началу и должны идти подряд без разрывов.
 */
export function validateCoverage(bounds: { posFrom: number; posTo: number }[], studentsCount: number): void {
  const sorted = [...bounds].sort((a, b) => a.posFrom - b.posFrom)
  let expected = 1
  for (const b of sorted) {
    if (b.posFrom > b.posTo) {
      throw new SubgroupCoverageError(`Подгруппа с границами ${b.posFrom}–${b.posTo}: начало больше конца`)
    }
    if (b.posFrom > expected) {
      throw new SubgroupCoverageError(`Пропуск в границах подгрупп: позиции ${expected}–${b.posFrom - 1} не входят ни в одну подгруппу`)
    }
    if (b.posFrom < expected) {
      throw new SubgroupCoverageError(`Наложение границ подгрупп: позиция ${b.posFrom} уже входит в предыдущую подгруппу`)
    }
    expected = b.posTo + 1
  }
  if (expected - 1 !== studentsCount) {
    throw new SubgroupCoverageError(
      `Границы подгрупп должны покрывать всех студентов группы (1–${studentsCount}), сейчас покрыто до ${expected - 1}`,
    )
  }
}

export interface DivisionSchemeRow {
  id: number
  groupId: number
  semesterId: number
  name: string
  partsCount: number
  isDefault: boolean
  validFrom: string
  validTo: string | null
  rowVersion: number
}

export interface SubgroupRow {
  id: number
  groupId: number
  schemeId: number
  no: number
  posFrom: number
  posTo: number
  validFrom: string
  validTo: string | null
  rowVersion: number
}

export function loadSchemeWithSubgroups(tx: DbLike, schemeId: number): DivisionSchemeRow & { subgroups: SubgroupRow[] } {
  const scheme = tx.select().from(divisionScheme).where(eq(divisionScheme.id, schemeId)).get()
  if (!scheme) throw new NotFoundError('division_scheme', schemeId)
  const subgroups = tx.select().from(subgroup).where(eq(subgroup.schemeId, schemeId)).orderBy(asc(subgroup.no)).all()
  return { ...scheme, subgroups } as unknown as DivisionSchemeRow & { subgroups: SubgroupRow[] }
}

/** Создание схемы деления (§2.5): границы подгрупп рассчитываются автоматически по числу студентов группы. */
export function createDivisionScheme(
  tx: DbLike,
  params: { groupId: number; semesterId: number; name: string; partsCount: number; isDefault: boolean },
  ctx: AuditContext = {},
): DivisionSchemeRow & { subgroups: SubgroupRow[] } {
  const group = tx.select().from(studyGroup).where(eq(studyGroup.id, params.groupId)).get()
  if (!group) throw new NotFoundError('study_group', params.groupId)
  if (group.studentsCount < params.partsCount) {
    throw new SubgroupCoverageError(
      `В группе ${group.studentsCount} студентов — их нельзя разделить на ${params.partsCount} подгруппы`,
    )
  }

  // «Основная» — в пределах пары группа+семестр: схема привязана к семестру (§2.5),
  // поэтому основная схема весеннего семестра не отменяет основную осеннего.
  if (params.isDefault) {
    const existingDefaults = tx
      .select()
      .from(divisionScheme)
      .where(and(eq(divisionScheme.groupId, params.groupId), eq(divisionScheme.semesterId, params.semesterId)))
      .all()
    for (const s of existingDefaults.filter((s) => s.isDefault)) {
      updateRow(tx, divisionScheme, s.id, { isDefault: false }, s.rowVersion, ctx)
    }
  }

  const scheme = createRow(
    tx,
    divisionScheme,
    {
      groupId: params.groupId,
      semesterId: params.semesterId,
      name: params.name,
      partsCount: params.partsCount,
      isDefault: params.isDefault,
      validFrom: group.validFrom,
    },
    ctx,
  )

  const parts = computeEvenSplit(group.studentsCount, params.partsCount)
  for (const part of parts) {
    createRow(
      tx,
      subgroup,
      { groupId: params.groupId, schemeId: scheme.id as number, no: part.no, posFrom: part.posFrom, posTo: part.posTo, validFrom: group.validFrom },
      ctx,
    )
  }

  return loadSchemeWithSubgroups(tx, scheme.id as number)
}

/** Правка границ подгрупп (§2.5): число подгрупп фиксировано схемой, меняются только posFrom/posTo. */
export function updateSubgroupBounds(
  tx: DbLike,
  schemeId: number,
  bounds: { subgroupId: number; rowVersion: number; posFrom: number; posTo: number }[],
  ctx: AuditContext = {},
): DivisionSchemeRow & { subgroups: SubgroupRow[] } {
  const scheme = tx.select().from(divisionScheme).where(eq(divisionScheme.id, schemeId)).get()
  if (!scheme) throw new NotFoundError('division_scheme', schemeId)
  const group = tx.select().from(studyGroup).where(eq(studyGroup.id, scheme.groupId)).get()!

  const existingSubgroups = tx.select().from(subgroup).where(eq(subgroup.schemeId, schemeId)).all()
  if (bounds.length !== existingSubgroups.length) {
    throw new Error('Число подгрупп в правке не совпадает со схемой')
  }
  const existingIds = new Set(existingSubgroups.map((s) => s.id))
  for (const b of bounds) {
    if (!existingIds.has(b.subgroupId)) throw new Error(`Подгруппа #${b.subgroupId} не относится к схеме #${schemeId}`)
  }

  validateCoverage(bounds, group.studentsCount)

  for (const b of bounds) {
    updateRow(tx, subgroup, b.subgroupId, { posFrom: b.posFrom, posTo: b.posTo }, b.rowVersion, ctx)
  }

  return loadSchemeWithSubgroups(tx, schemeId)
}

/** Смена основной схемы деления (§2.5): основной может быть только одна схема на группу в семестре. */
export function setDefaultDivisionScheme(tx: DbLike, id: number, ctx: AuditContext = {}): void {
  const scheme = tx.select().from(divisionScheme).where(eq(divisionScheme.id, id)).get()
  if (!scheme) throw new NotFoundError('division_scheme', id)

  const siblings = tx
    .select()
    .from(divisionScheme)
    .where(and(eq(divisionScheme.groupId, scheme.groupId), eq(divisionScheme.semesterId, scheme.semesterId)))
    .all()
  for (const s of siblings) {
    if (s.isDefault && s.id !== id) updateRow(tx, divisionScheme, s.id, { isDefault: false }, s.rowVersion, ctx)
  }
  if (!scheme.isDefault) updateRow(tx, divisionScheme, id, { isDefault: true }, scheme.rowVersion, ctx)
}
