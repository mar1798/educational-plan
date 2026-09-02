import { eq } from 'drizzle-orm'
import { pairGrid } from '../schema/org'
import { nowIso, withAudit, type AuditContext } from './audit'
import { OptimisticLockError } from './base-repo'
import type { DbLike } from './types'

// Разумные значения по умолчанию, чтобы страница настроек не открывалась пустой —
// в отличие от calendar_day (§2.8), для сетки звонков предзаполнение не запрещено
// (запрет «без предзаполненного справочника» в PLAN.md касается именно календаря/праздников).
const DEFAULT_ROWS: { pairNo: number; startsAt: string; endsAt: string }[] = [
  { pairNo: 1, startsAt: '08:00', endsAt: '09:30' },
  { pairNo: 2, startsAt: '09:40', endsAt: '11:10' },
  { pairNo: 3, startsAt: '11:30', endsAt: '13:00' },
  { pairNo: 4, startsAt: '13:10', endsAt: '14:40' },
  { pairNo: 5, startsAt: '14:50', endsAt: '16:20' },
  { pairNo: 6, startsAt: '16:30', endsAt: '18:00' },
]

export function ensurePairGrid(db: DbLike): void {
  const existing = db.select({ pairNo: pairGrid.pairNo }).from(pairGrid).all()
  if (existing.length > 0) return
  for (const row of DEFAULT_ROWS) {
    db.insert(pairGrid).values({ ...row, academicHours: 2, enabled: true }).run()
  }
}

export interface PairGridRowInput {
  pairNo: number
  rowVersion: number
  startsAt: string
  endsAt: string
  academicHours: number
  enabled: boolean
}

/** pair_grid.pair_no — сам PK (§4 п.2), поэтому правка идёт по нему, а не по числовому id. */
export function updatePairGridRow(tx: DbLike, input: PairGridRowInput, ctx: AuditContext = {}): Record<string, unknown> {
  const before = tx.select().from(pairGrid).where(eq(pairGrid.pairNo, input.pairNo)).get() as Record<string, unknown> | undefined
  if (!before) throw new Error(`Пара №${input.pairNo} не найдена в сетке звонков`)
  if (before.rowVersion !== input.rowVersion) throw new OptimisticLockError('pair_grid', input.pairNo)

  const updated = tx
    .update(pairGrid)
    .set({
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      academicHours: input.academicHours,
      enabled: input.enabled,
      updatedAt: nowIso(),
      rowVersion: (before.rowVersion as number) + 1,
    })
    .where(eq(pairGrid.pairNo, input.pairNo))
    .returning()
    .get() as Record<string, unknown>

  withAudit(tx, 'pair_grid', input.pairNo, 'update', before, updated, ctx)
  return updated
}
