import ExcelJS from 'exceljs'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensurePairGrid } from '../../src/main/db/repo/pair-grid'
import { createTemplate, placeEntry } from '../../src/main/db/repo/schedule-template'
import { exportGroupScheduleExcel, exportSummaryScheduleExcel } from '../../src/main/export/excel'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('export/excel (§5.10)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld

  beforeEach(() => {
    ctx = createTestDb()
    ensurePairGrid(ctx.db)
    world = seedMinimalWorld(ctx.db)
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('экспортирует расписание группы: файл открывается, шапка и занятие на месте', async () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 3, pairNo: 3, weekParity: 'all', roomId: world.roomId })

    const filePath = join(ctx.dir, 'group.xlsx')
    await exportGroupScheduleExcel(ctx.db, tmpl.id as number, world.groupId, filePath)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    const sheet = wb.worksheets[0]!
    expect(sheet.getCell(2, 2).value).toBe('Понедельник')
    // Пара 3 (строка 5 = 3 + 2 заголовка), среда = 3-й день недели -> столбец 4
    const cell = sheet.getCell(5, 4).value
    expect(String(cell)).toContain('Анатомия')
  })

  it('сводный экспорт создаёт по листу на каждую встречающуюся группу', async () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: null })

    const filePath = join(ctx.dir, 'summary.xlsx')
    await exportSummaryScheduleExcel(ctx.db, tmpl.id as number, filePath)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    expect(wb.worksheets).toHaveLength(1)
  })
})
