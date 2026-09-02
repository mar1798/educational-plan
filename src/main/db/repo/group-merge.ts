import { and, eq, gte, isNull, or, sql } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { streamMember, teachingLoad } from '../schema/load'
import type { AuditContext } from './audit'
import { updateRow } from './base-repo'
import type { DbLike } from './types'

export interface GroupMergeCounts {
  teachingLoad: number
  streamMember: number
}

// «Активна» на дату слияния — учитываются и уже открытые (validTo null), и закрытые
// позже даты слияния строки (§2.4: «будущие переносятся», прошлое не трогаем).
function activeCondition(groupCol: SQLiteColumn, validToCol: SQLiteColumn, groupId: number, mergeDate: string) {
  return and(eq(groupCol, groupId), or(isNull(validToCol), gte(validToCol, mergeDate)))
}

function countActive(tx: DbLike, table: SQLiteTable, groupCol: SQLiteColumn, validToCol: SQLiteColumn, groupId: number, mergeDate: string): number {
  const row = tx
    .select({ n: sql<number>`count(*)` })
    .from(table)
    .where(activeCondition(groupCol, validToCol, groupId, mergeDate))
    .get() as { n: number }
  return row.n
}

/** Сколько активных строк нагрузки/потоков сейчас ссылается на группу — для предпросмотра слияния. */
export function countActiveGroupRefs(tx: DbLike, groupId: number, mergeDate: string): GroupMergeCounts {
  return {
    teachingLoad: countActive(tx, teachingLoad, teachingLoad.groupId, teachingLoad.validTo, groupId, mergeDate),
    streamMember: countActive(tx, streamMember, streamMember.groupId, streamMember.validTo, groupId, mergeDate),
  }
}

function reassignActive(
  tx: DbLike,
  table: SQLiteTable,
  groupCol: SQLiteColumn,
  validToCol: SQLiteColumn,
  sourceId: number,
  targetId: number,
  mergeDate: string,
  ctx: AuditContext,
): number {
  const rows = tx.select().from(table).where(activeCondition(groupCol, validToCol, sourceId, mergeDate)).all() as Array<{
    id: number
    rowVersion: number
  }>
  for (const row of rows) {
    updateRow(tx, table, row.id, { groupId: targetId }, row.rowVersion, ctx)
  }
  return rows.length
}

/** Переносит активные ссылки нагрузки/потоков с поглощённой группы на целевую (§2.4). */
export function reassignActiveGroupRefs(
  tx: DbLike,
  sourceId: number,
  targetId: number,
  mergeDate: string,
  ctx: AuditContext,
): GroupMergeCounts {
  return {
    teachingLoad: reassignActive(tx, teachingLoad, teachingLoad.groupId, teachingLoad.validTo, sourceId, targetId, mergeDate, ctx),
    streamMember: reassignActive(tx, streamMember, streamMember.groupId, streamMember.validTo, sourceId, targetId, mergeDate, ctx),
  }
}
