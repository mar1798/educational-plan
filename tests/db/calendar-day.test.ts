import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OptimisticLockError } from '../../src/main/db/repo/base-repo'
import { epochDay, generateCalendarDays, listCalendarDays, setCalendarDayKind } from '../../src/main/db/repo/calendar-day'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('генерация calendar_day на период семестра (§2.8)', () => {
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

  it('материализует все дни семестра: Вс — выходной, остальные — учебные', () => {
    const generated = ctx.db.transaction((tx) => generateCalendarDays(tx, world.semesterId))
    // семестр 2026-09-01..2027-01-15 из seedMinimalWorld
    const days = listCalendarDays(ctx.db, '2026-09-01', '2027-01-15')
    expect(generated).toBe(days.length)

    const sunday = days.find((d) => d.date === '2026-09-06')! // воскресенье
    expect(sunday.kind).toBe('weekend')
    const monday = days.find((d) => d.date === '2026-09-07')!
    expect(monday.kind).toBe('study')
  })

  it('повторный запуск не перезаписывает уже сгенерированные/поправленные дни', () => {
    ctx.db.transaction((tx) => generateCalendarDays(tx, world.semesterId))
    const before = ctx.db.select().from(schema.calendarDay).where(eq(schema.calendarDay.date, '2026-09-07')).get()!
    ctx.db.transaction((tx) =>
      setCalendarDayKind(tx, { date: '2026-09-07', rowVersion: before.rowVersion, kind: 'holiday', movedFromDate: null, note: 'День знаний' }),
    )

    const regenerated = ctx.db.transaction((tx) => generateCalendarDays(tx, world.semesterId))
    expect(regenerated).toBe(0)

    const after = ctx.db.select().from(schema.calendarDay).where(eq(schema.calendarDay.date, '2026-09-07')).get()!
    expect(after.kind).toBe('holiday')
  })
})

describe('правка дня календаря (§2.8)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld

  beforeEach(() => {
    ctx = createTestDb()
    world = seedMinimalWorld(ctx.db)
    ctx.db.transaction((tx) => generateCalendarDays(tx, world.semesterId))
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('отмечает праздник и пишет правку в change_log', () => {
    const before = ctx.db.select().from(schema.calendarDay).where(eq(schema.calendarDay.date, '2026-09-07')).get()!
    const { row } = ctx.db.transaction((tx) =>
      setCalendarDayKind(
        tx,
        { date: '2026-09-07', rowVersion: before.rowVersion, kind: 'holiday', movedFromDate: null, note: null },
        { reason: 'праздник' },
      ),
    )
    expect(row.kind).toBe('holiday')

    const logs = ctx.db
      .select()
      .from(schema.changeLog)
      .where(eq(schema.changeLog.entity, 'calendar_day'))
      .all()
    expect(logs).toHaveLength(1)
    expect(logs[0]!.entityId).toBe(epochDay('2026-09-07'))
    expect(logs[0]!.reason).toBe('праздник')
  })

  it('праздник отменяет запланированные занятия дня, проведённые не трогает', () => {
    const plannedId = ctx.db
      .insert(schema.lesson)
      .values({
        date: '2026-09-07',
        pairNo: 1,
        teachingLoadId: world.teachingLoadId,
        teacherId: world.teacherId,
        roomId: world.roomId,
        disciplineId: world.disciplineId,
        lessonKind: 'theory',
        status: 'planned',
        operationId: world.operationId,
      })
      .returning({ id: schema.lesson.id })
      .get().id

    const heldId = ctx.db
      .insert(schema.lesson)
      .values({
        date: '2026-09-07',
        pairNo: 2,
        teachingLoadId: world.teachingLoadId,
        teacherId: world.teacherId,
        roomId: world.roomId2,
        disciplineId: world.disciplineId,
        lessonKind: 'theory',
        status: 'held',
        operationId: world.operationId,
      })
      .returning({ id: schema.lesson.id })
      .get().id

    const before = ctx.db.select().from(schema.calendarDay).where(eq(schema.calendarDay.date, '2026-09-07')).get()!
    const { cancelledLessons } = ctx.db.transaction((tx) =>
      setCalendarDayKind(tx, { date: '2026-09-07', rowVersion: before.rowVersion, kind: 'holiday', movedFromDate: null, note: null }),
    )
    expect(cancelledLessons).toBe(1)

    expect(ctx.db.select().from(schema.lesson).where(eq(schema.lesson.id, plannedId)).get()!.status).toBe('cancelled')
    expect(ctx.db.select().from(schema.lesson).where(eq(schema.lesson.id, heldId)).get()!.status).toBe('held')
  })

  it('отметка праздника без полей примечания не стирает уже введённые примечание и перенос', () => {
    const before = ctx.db.select().from(schema.calendarDay).where(eq(schema.calendarDay.date, '2026-09-07')).get()!
    const withNote = ctx.db.transaction((tx) =>
      setCalendarDayKind(tx, { date: '2026-09-07', rowVersion: before.rowVersion, kind: 'study', note: 'перенос пар' }),
    ).row

    const afterHoliday = ctx.db.transaction((tx) =>
      setCalendarDayKind(tx, { date: '2026-09-07', rowVersion: withNote.rowVersion as number, kind: 'holiday' }),
    ).row

    expect(afterHoliday.kind).toBe('holiday')
    expect(afterHoliday.note).toBe('перенос пар')
  })

  it('оптимистичная блокировка: устаревшая версия строки блокирует правку дня', () => {
    expect(() =>
      ctx.db.transaction((tx) =>
        setCalendarDayKind(tx, { date: '2026-09-07', rowVersion: 999, kind: 'holiday', movedFromDate: null, note: null }),
      ),
    ).toThrow(OptimisticLockError)
  })

  it('перенос дня: рабочая суббота вместо праздничного понедельника', () => {
    // Перенесённый день попадает в тот же диапазон генерации, значит уже создан как weekend/study.
    const saturday = ctx.db.select().from(schema.calendarDay).where(eq(schema.calendarDay.date, '2026-09-12')).get()!
    const { row } = ctx.db.transaction((tx) =>
      setCalendarDayKind(tx, {
        date: '2026-09-12',
        rowVersion: saturday.rowVersion,
        kind: 'moved_workday',
        movedFromDate: '2026-09-07',
        note: null,
      }),
    )
    expect(row.kind).toBe('moved_workday')
    expect(row.movedFromDate).toBe('2026-09-07')
  })
})
