import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../src/main/db/migrate'
import { createTestDb } from './helpers'

describe('миграции (§1.1)', () => {
  let ctx: ReturnType<typeof createTestDb> | undefined

  afterEach(() => {
    ctx?.sqlite.close()
    if (ctx) rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('на пустом файле создаёт полную схему из §4.3', () => {
    ctx = createTestDb()
    const rows = ctx.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'",
      )
      .all() as { name: string }[]
    const names = rows.map((r) => r.name).sort()

    const expected = [
      'academic_year', 'app_setting', 'backup', 'building', 'calendar_day', 'calendar_period',
      'change_log', 'cmc', 'constraint_weight', 'curriculum', 'curriculum_row', 'curriculum_week',
      'discipline', 'division_scheme', 'lesson', 'lesson_group', 'operation', 'operation_snapshot',
      'other_load', 'pair_grid', 'room', 'schedule_template', 'semester', 'speciality', 'stream',
      'stream_member', 'study_group', 'subgroup', 'substitution', 'teacher', 'teacher_absence',
      'teacher_category', 'teacher_qualification', 'teaching_load', 'template_entry',
    ].sort()

    expect(names).toEqual(expected)
  })

  it('повторный запуск не повторяет уже применённые миграции', () => {
    ctx = createTestDb()
    expect(() => runMigrations(ctx!.db, `${__dirname}/../../drizzle`)).not.toThrow()
  })

  it('PRAGMA foreign_keys включён (§4.1)', () => {
    ctx = createTestDb()
    expect(ctx.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})
