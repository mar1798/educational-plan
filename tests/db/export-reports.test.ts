import ExcelJS from 'exceljs'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensurePairGrid } from '../../src/main/db/repo/pair-grid'
import { runOperation } from '../../src/main/db/repo/operations'
import { applyRollout, createTemplate, placeEntry, planRollout } from '../../src/main/db/repo/schedule-template'
import { applyCancelLesson } from '../../src/main/db/repo/substitution'
import { exportDeductedHoursReportExcel, exportRoomUtilizationReportExcel, exportTeacherLoadReportExcel } from '../../src/main/export/excel'
import * as schema from '../../src/main/db/schema'
import { eq } from 'drizzle-orm'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('export/excel: отчёты этапа 7 (§этап 7)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld
  let lessonId: number

  beforeEach(() => {
    ctx = createTestDb()
    ensurePairGrid(ctx.db)
    world = seedMinimalWorld(ctx.db)

    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: world.roomId })
    const plan = planRollout(ctx.db, { templateId: tmpl.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-01' })
    runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, plan, { operationId: opId }))
    lessonId = ctx.db.select().from(schema.lesson).where(eq(schema.lesson.date, '2026-09-01')).get()!.id
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('exportTeacherLoadReportExcel создаёт файл со строкой преподавателя', async () => {
    const filePath = join(ctx.dir, 'nagruzka.xlsx')
    await exportTeacherLoadReportExcel(ctx.db, world.academicYearId, filePath)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    const sheet = wb.worksheets[0]!
    expect(sheet.getCell(2, 1).value).toBe('Преподаватель')
    const rowsText = sheet.getSheetValues().flat().map(String)
    expect(rowsText.some((v) => v.includes('Иванова'))).toBe(true)
  })

  it('exportDeductedHoursReportExcel создаёт файл со строкой отменённого занятия', async () => {
    applyCancelLesson(ctx.db, { lessonId, reason: null }, {})
    const filePath = join(ctx.dir, 'vychtennye.xlsx')
    await exportDeductedHoursReportExcel(ctx.db, '2026-09-01', '2026-09-01', filePath)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    const rowsText = wb.worksheets[0]!.getSheetValues().flat().map(String)
    expect(rowsText.some((v) => v.includes('Анатомия'))).toBe(true)
  })

  it('exportRoomUtilizationReportExcel создаёт файл со строками кабинетов', async () => {
    ctx.db.insert(schema.calendarDay).values({ date: '2026-09-01', semesterId: world.semesterId, kind: 'study' }).run()
    const filePath = join(ctx.dir, 'kabinety.xlsx')
    await exportRoomUtilizationReportExcel(ctx.db, '2026-09-01', '2026-09-01', filePath)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    expect(wb.worksheets[0]!.rowCount).toBeGreaterThanOrEqual(3) // заголовок + шапка + минимум 1 кабинет
  })
})
