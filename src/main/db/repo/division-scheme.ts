import { and, asc, count, eq, gte, isNotNull, isNull, ne } from 'drizzle-orm'
import type { Db } from '../client'
import { semester } from '../schema/calendar'
import { teachingLoad } from '../schema/load'
import { divisionScheme, studyGroup, subgroup } from '../schema/people'
import { lessonGroup } from '../schema/schedule'
import type { AuditContext } from './audit'
import { createRow, deleteRow, NotFoundError, updateRow } from './base-repo'
import { runOperation } from './operations'
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
  clinicalSplit: 'auto' | 'manual' | null
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
  params: { groupId: number; semesterId: number; name: string; partsCount: number; isDefault: boolean; clinicalSplit?: 'auto' },
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
      clinicalSplit: params.clinicalSplit ?? null,
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
  // Завуч иногда делит не по порогам (п. 44) — ручная правка «замораживает» клиническую
  // схему, иначе следующая смена численности молча вернула бы ровное деление.
  if (scheme.clinicalSplit === 'auto') {
    updateRow(tx, divisionScheme, schemeId, { clinicalSplit: 'manual' }, scheme.rowVersion, ctx)
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

export const CLINICAL_SCHEME_NAME = 'Клинические'

/**
 * Пороги деления на клинических занятиях (решение п. 44, подтверждено завучем): меньше 15 —
 * вся группа вместе, 15–22 — на две, от 23 — на три.
 */
export function clinicalPartsCount(studentsCount: number): 1 | 2 | 3 {
  if (studentsCount < 15) return 1
  if (studentsCount < 23) return 2
  return 3
}

function isSubgroupReferenced(tx: DbLike, subgroupId: number): boolean {
  const inLoad = tx.select({ n: count() }).from(teachingLoad).where(eq(teachingLoad.subgroupId, subgroupId)).get()!.n
  const inLessons = tx.select({ n: count() }).from(lessonGroup).where(eq(lessonGroup.subgroupId, subgroupId)).get()!.n
  return inLoad + inLessons > 0
}

/**
 * Перекраивает схему на parts ровных отрезков. Подгруппу, на которую уже ссылается нагрузка
 * или занятие, убрать нельзя — тогда число частей остаётся прежним и меняются только границы:
 * ссылка на «п/гр 3» не должна повиснуть из-за того, что группа похудела.
 */
function reshapeScheme(tx: DbLike, scheme: typeof divisionScheme.$inferSelect, studentsCount: number, parts: number, ctx: AuditContext): void {
  const subs = tx.select().from(subgroup).where(eq(subgroup.schemeId, scheme.id)).orderBy(asc(subgroup.no)).all()
  if (subs.slice(parts).some((s) => isSubgroupReferenced(tx, s.id))) parts = subs.length
  if (studentsCount < parts) {
    throw new SubgroupCoverageError(
      `В группе ${studentsCount} студентов — схему «${scheme.name}» на ${parts} подгруппы не разделить. Сначала уберите её из нагрузки`,
    )
  }

  for (const s of subs.slice(parts)) deleteRow(tx, subgroup, s.id, ctx)
  for (const part of computeEvenSplit(studentsCount, parts)) {
    const existing = subs.find((s) => s.no === part.no)
    if (!existing) {
      createRow(tx, subgroup, { groupId: scheme.groupId, schemeId: scheme.id, no: part.no, posFrom: part.posFrom, posTo: part.posTo, validFrom: scheme.validFrom }, ctx)
    } else if (existing.posFrom !== part.posFrom || existing.posTo !== part.posTo) {
      updateRow(tx, subgroup, existing.id, { posFrom: part.posFrom, posTo: part.posTo }, existing.rowVersion, ctx)
    }
  }
  if (scheme.partsCount !== parts) updateRow(tx, divisionScheme, scheme.id, { partsCount: parts }, scheme.rowVersion, ctx)
}

/**
 * Ручную схему после смены численности дотягиваем до нового N, по возможности сохраняя
 * границы: двигаем только конец последней подгруппы. Не вышло (группа сократилась сильнее) —
 * делим ровно на то же число частей. Без этого покрытие 1..N (§2.5) молча ломалось.
 */
function fitManualScheme(tx: DbLike, scheme: typeof divisionScheme.$inferSelect, studentsCount: number, ctx: AuditContext): void {
  const subs = tx.select().from(subgroup).where(eq(subgroup.schemeId, scheme.id)).orderBy(asc(subgroup.posFrom)).all()
  const last = subs.at(-1)
  if (!last || last.posTo === studentsCount) return
  const stretched = subs.map((s) => (s === last ? { posFrom: s.posFrom, posTo: studentsCount } : s))
  try {
    validateCoverage(stretched, studentsCount)
  } catch {
    reshapeScheme(tx, scheme, studentsCount, scheme.partsCount, ctx)
    return
  }
  updateRow(tx, subgroup, last.id, { posTo: studentsCount }, last.rowVersion, ctx)
}

function syncClinicalScheme(
  tx: DbLike,
  group: typeof studyGroup.$inferSelect,
  semesterId: number,
  schemes: (typeof divisionScheme.$inferSelect)[],
  ctx: AuditContext,
): void {
  const parts = clinicalPartsCount(group.studentsCount)
  // Закрытую или замороженную схему не трогаем и не заводим взамен новую: это решение завуча.
  const scheme = schemes.find((s) => s.semesterId === semesterId && s.clinicalSplit != null)
  if (!scheme) {
    if (parts === 1) return
    const hasDefault = schemes.some((s) => s.semesterId === semesterId && s.isDefault && s.validTo == null)
    createDivisionScheme(
      tx,
      { groupId: group.id, semesterId, name: CLINICAL_SCHEME_NAME, partsCount: parts, isDefault: !hasDefault, clinicalSplit: 'auto' },
      ctx,
    )
    return
  }
  if (scheme.clinicalSplit !== 'auto' || scheme.validTo != null) return

  if (parts === 1) {
    // Группа стала меньше 15 — делить не нужно; схему удаляем, если её ещё никто не использует.
    const subs = tx.select().from(subgroup).where(eq(subgroup.schemeId, scheme.id)).all()
    const usedInLoad = tx.select({ n: count() }).from(teachingLoad).where(eq(teachingLoad.divisionSchemeId, scheme.id)).get()!.n > 0
    if (!usedInLoad && !subs.some((s) => isSubgroupReferenced(tx, s.id))) {
      for (const s of subs) deleteRow(tx, subgroup, s.id, ctx)
      deleteRow(tx, divisionScheme, scheme.id, ctx)
      return
    }
  }
  reshapeScheme(tx, scheme, group.studentsCount, Math.max(parts, 2), ctx)
}

/**
 * Приводит схемы деления группы в соответствие с её численностью — во всех незакрытых
 * семестрах: клиническая схема пересчитывается по порогам п. 44, ручные дотягиваются до
 * нового N. Зовётся при создании группы, смене численности и заведении семестра.
 */
export function syncGroupSchemes(tx: DbLike, groupId: number, ctx: AuditContext = {}): void {
  const group = tx.select().from(studyGroup).where(eq(studyGroup.id, groupId)).get()
  if (!group) throw new NotFoundError('study_group', groupId)
  const openSemesterIds = new Set(
    tx.select({ id: semester.id }).from(semester).where(ne(semester.status, 'closed')).all().map((s) => s.id),
  )
  const schemes = tx
    .select()
    .from(divisionScheme)
    .where(eq(divisionScheme.groupId, groupId))
    .all()
    .filter((s) => openSemesterIds.has(s.semesterId))

  for (const s of schemes) {
    if (s.validTo == null && s.clinicalSplit !== 'auto') fitManualScheme(tx, s, group.studentsCount, ctx)
  }
  if (group.validTo != null) return
  for (const semesterId of openSemesterIds) syncClinicalScheme(tx, group, semesterId, schemes, ctx)
}

/** Новый семестр: каждой действующей группе — своя клиническая схема (п. 44). */
export function syncSemesterSchemes(tx: DbLike, semesterId: number, ctx: AuditContext = {}): void {
  const groups = tx.select().from(studyGroup).where(isNull(studyGroup.validTo)).all()
  for (const g of groups) {
    const schemes = tx.select().from(divisionScheme).where(eq(divisionScheme.groupId, g.id)).all()
    syncClinicalScheme(tx, g, semesterId, schemes, ctx)
  }
}

/** Вернуть замороженную клиническую схему к делению по порогам п. 44. */
export function resetClinicalScheme(tx: DbLike, schemeId: number, ctx: AuditContext = {}): DivisionSchemeRow & { subgroups: SubgroupRow[] } {
  const scheme = tx.select().from(divisionScheme).where(eq(divisionScheme.id, schemeId)).get()
  if (!scheme) throw new NotFoundError('division_scheme', schemeId)
  if (scheme.clinicalSplit == null) throw new SubgroupCoverageError(`Схема «${scheme.name}» заведена вручную — порогов деления у неё нет`)
  const group = tx.select().from(studyGroup).where(eq(studyGroup.id, scheme.groupId)).get()!
  if (scheme.clinicalSplit === 'manual') updateRow(tx, divisionScheme, schemeId, { clinicalSplit: 'auto' }, scheme.rowVersion, ctx)
  const fresh = tx.select().from(divisionScheme).where(eq(divisionScheme.id, schemeId)).get()!
  reshapeScheme(tx, fresh, group.studentsCount, Math.max(clinicalPartsCount(group.studentsCount), 2), ctx)
  return loadSchemeWithSubgroups(tx, schemeId)
}

/**
 * Разовое заполнение для базы, заведённой до появления клинических схем: пока ни одной такой
 * схемы нет, каждая действующая группа от 15 человек получает свою. Операцией — чтобы
 * завуч мог откатить её на экране «Операции».
 */
export function ensureClinicalSchemes(db: Db): void {
  if (db.select({ id: divisionScheme.id }).from(divisionScheme).where(isNotNull(divisionScheme.clinicalSplit)).get()) return
  const groups = db.select().from(studyGroup).where(and(isNull(studyGroup.validTo), gte(studyGroup.studentsCount, 15))).all()
  if (groups.length === 0) return
  runOperation(db, 'bulk_edit', { clinicalSchemes: true }, (tx, operationId) => {
    for (const g of groups) syncGroupSchemes(tx, g.id, { operationId, reason: 'клинические подгруппы по численности' })
  })
}
