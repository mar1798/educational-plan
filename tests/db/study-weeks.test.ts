import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { studyWeeksOfSemester, studyWeeksWarning } from '../../src/main/services/study-weeks'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('учебные недели семестра (этап В)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld

  beforeEach(() => {
    ctx = createTestDb()
    world = seedMinimalWorld(ctx.db) // 2026-09-01 (вт) … 2027-01-15
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('нумерует календарные недели Пн–Сб, первая неделя начинается с понедельника до старта семестра', () => {
    const weeks = studyWeeksOfSemester(ctx.db, world.semesterId)
    expect(weeks[0]).toEqual({ no: 1, monday: '2026-08-31' })
    expect(weeks[1]).toEqual({ no: 2, monday: '2026-09-07' })
  })

  it('неделя целиком на каникулах или праздниках номера не получает', () => {
    const base = studyWeeksOfSemester(ctx.db, world.semesterId).length
    // неделя 2026-09-14 … 09-20: Пн–Сб каникулы, воскресенье не учитывается
    for (let d = 14; d <= 19; d++) {
      ctx.db.insert(schema.calendarDay).values({ date: `2026-09-${d}`, semesterId: world.semesterId, kind: d === 14 ? 'holiday' : 'vacation' }).run()
    }
    const weeks = studyWeeksOfSemester(ctx.db, world.semesterId)
    expect(weeks).toHaveLength(base - 1)
    expect(weeks.some((w) => w.monday === '2026-09-14')).toBe(false)
    expect(weeks.find((w) => w.monday === '2026-09-21')!.no).toBe(weeks.find((w) => w.monday === '2026-09-07')!.no + 1)
  })

  it('один праздничный день неделю не убирает; перенесённый рабочий день — учебный', () => {
    ctx.db.insert(schema.calendarDay).values({ date: '2026-09-14', semesterId: world.semesterId, kind: 'holiday' }).run()
    expect(studyWeeksOfSemester(ctx.db, world.semesterId).some((w) => w.monday === '2026-09-14')).toBe(true)
    for (let d = 15; d <= 19; d++) ctx.db.insert(schema.calendarDay).values({ date: `2026-09-${d}`, semesterId: world.semesterId, kind: 'weekend' }).run()
    ctx.db.insert(schema.calendarDay).values({ date: '2026-09-19', semesterId: world.semesterId, kind: 'moved_workday', movedFromDate: '2026-09-14' }).onConflictDoNothing().run()
  })

  it('предупреждает, если учебных недель не столько, сколько в семестре', () => {
    expect(studyWeeksWarning(ctx.db, world.semesterId)).toMatch(/учебных недель/)
  })
})
