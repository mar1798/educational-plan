import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { calendarDay, semester } from '../schema/calendar'
import { lesson } from '../schema/schedule'
import { nowIso, withAudit, type AuditContext } from './audit'
import { NotFoundError, OptimisticLockError } from './base-repo'
import type { DbLike } from './types'

/**
 * calendar_day.date — текстовый PK, а не integer id (§4, источник истины), поэтому
 * функции base-repo (createRow/updateRow, завязанные на числовой id) сюда не подходят —
 * здесь минимальные аналоги под свой ключ. Суррогатный числовой id для change_log/истории —
 * число дней от эпохи, обратимо считается из даты при каждом обращении.
 */
export function epochDay(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Материализует calendar_day на весь период семестра (§2.8): Вс — выходной,
 * остальные дни — учебные по умолчанию, дальше правятся вручную (праздники/переносы).
 * Идемпотентно: уже существующие дни (в т.ч. вручную поправленные) не перезаписывает.
 */
export function generateCalendarDays(tx: DbLike, semesterId: number): number {
  const sem = tx.select().from(semester).where(eq(semester.id, semesterId)).get() as
    | { startsOn: string; endsOn: string }
    | undefined
  if (!sem) throw new NotFoundError('semester', semesterId)

  let generated = 0
  for (let date = sem.startsOn; date <= sem.endsOn; date = addDays(date, 1)) {
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay()
    const inserted = tx
      .insert(calendarDay)
      .values({ date, semesterId, kind: dayOfWeek === 0 ? 'weekend' : 'study' })
      .onConflictDoNothing({ target: calendarDay.date })
      .returning({ date: calendarDay.date })
      .get()
    if (inserted) generated++
  }
  return generated
}

export interface SetCalendarDayKindInput {
  date: string
  rowVersion: number
  kind: 'study' | 'weekend' | 'holiday' | 'vacation' | 'moved_workday'
  // undefined — «не трогать»: отметка праздника одним кликом (§2.8) шлёт только kind
  // и не должна стирать примечание и дату переноса, введённые в панели дня.
  movedFromDate?: string | null
  note?: string | null
}

/**
 * Правка одного дня (§2.8): «отметить праздник — один клик», пишется в change_log
 * как обычная правка (withAudit) — формального operation-конверта здесь не нужно,
 * тот механизм (§1.5) обслуживает массовые/отменяемые операции, не единичную правку.
 * Праздник/каникулы отменяют запланированные (не проведённые) занятия этого дня (§2 «Добавили праздник»).
 */
export function setCalendarDayKind(
  tx: DbLike,
  input: SetCalendarDayKindInput,
  ctx: AuditContext = {},
): { row: Record<string, unknown>; cancelledLessons: number } {
  const before = tx.select().from(calendarDay).where(eq(calendarDay.date, input.date)).get() as
    | Record<string, unknown>
    | undefined
  if (!before) throw new NotFoundError('calendar_day', epochDay(input.date))
  if (before.rowVersion !== input.rowVersion) throw new OptimisticLockError('calendar_day', epochDay(input.date))

  let cancelledLessons = 0
  if (input.kind === 'holiday' || input.kind === 'vacation') {
    const cancelled = tx
      .update(lesson)
      .set({ status: 'cancelled', updatedAt: nowIso() })
      .where(and(eq(lesson.date, input.date), eq(lesson.status, 'planned')))
      .returning({ id: lesson.id })
      .all()
    cancelledLessons = cancelled.length
  }

  const updated = tx
    .update(calendarDay)
    .set({
      kind: input.kind,
      movedFromDate: input.movedFromDate === undefined ? (before.movedFromDate as string | null) : input.movedFromDate,
      note: input.note === undefined ? (before.note as string | null) : input.note,
      updatedAt: nowIso(),
      rowVersion: (before.rowVersion as number) + 1,
    })
    .where(eq(calendarDay.date, input.date))
    .returning()
    .get() as Record<string, unknown>

  withAudit(tx, 'calendar_day', epochDay(input.date), 'update', before, updated, ctx)
  return { row: updated, cancelledLessons }
}

export function listCalendarDays(tx: DbLike, from: string, to: string): Record<string, unknown>[] {
  return tx
    .select()
    .from(calendarDay)
    .where(and(gte(calendarDay.date, from), lte(calendarDay.date, to)))
    .orderBy(asc(calendarDay.date))
    .all() as Record<string, unknown>[]
}
