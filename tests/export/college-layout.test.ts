import ExcelJS from 'exceljs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensurePairGrid } from '../../src/main/db/repo/pair-grid'
import { createTemplate, placeEntry } from '../../src/main/db/repo/schedule-template'
import { exportCollegeScheduleExcel, SETTING_DIRECTOR } from '../../src/main/export/college-schedule'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from '../db/helpers'

describe('экспорт сводного расписания в формате колледжа (этап Б)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld
  let sheet: ExcelJS.Worksheet

  beforeEach(async () => {
    ctx = createTestDb()
    ensurePairGrid(ctx.db)
    world = seedMinimalWorld(ctx.db)
    ctx.db.insert(schema.appSetting).values({ key: SETTING_DIRECTOR, value: 'Иванов И.И.' }).run()
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 3, pairNo: 2, weekParity: 'all', roomId: null })
    const filePath = join(ctx.dir, 'college.xlsx')
    await exportCollegeScheduleExcel(ctx.db, tmpl.id as number, filePath)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    sheet = wb.worksheets[0]!
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('шапка и подписи: ФИО директора есть, у зама только должность и линия', () => {
    expect(String(sheet.getCell(1, 1).value)).toMatch(/^Расписание на .+ учебный год \(действует с 01\.09\.2026\)$/)
    const texts: string[] = []
    sheet.eachRow((row) => row.eachCell((c) => typeof c.value === 'string' && texts.push(c.value)))
    expect(texts.some((t) => t.startsWith('Утверждаю: директор') && t.includes('Иванов И.И.'))).toBe(true)
    const agreed = texts.find((t) => t.startsWith('Согласовано: зам. директора'))
    expect(agreed).toBeDefined()
    expect(agreed).not.toContain('Иванов')
  })

  it('один лист, колонки как в шаблоне: День | Пары | Часы занятий, дальше группы; зеркала справа нет', () => {
    expect(sheet.workbook.worksheets).toHaveLength(1)
    const row = sheet.getRow(3)
    expect([1, 2, 3].map((c) => row.getCell(c).value)).toEqual(['День', 'Пары', 'Часы занятий'])
    expect(row.getCell(4).value).toBe('11 СД')
    expect(row.getCell(5).value).toBeNull()
  })

  it('день — объединение на 12 строк, пара — на две; время из сетки звонков', () => {
    expect(sheet.getCell(4, 1).value).toBe('ПОНЕДЕЛЬНИК')
    expect(sheet.getCell(4 + 12, 1).value).toBe('ВТОРНИК')
    expect(sheet.getCell(4, 1).alignment?.textRotation).toBe(90)
    expect(sheet.getCell(5, 1).isMerged).toBe(true)
    expect(sheet.getCell(4 + 11, 1).isMerged).toBe(true)
    expect(sheet.getCell(4 + 12, 2).isMerged).toBe(true)
    expect(sheet.getCell(4, 3).value).toBe('08:00-09:30')
    expect(sheet.getCell(6, 3).value).toBe('09:35-11:05')
  })

  it('занятие: дисциплина сверху, преподаватель снизу в колонке группы', () => {
    // среда = 3-й день → 4 + 2*12; пара 2 → +2 строки
    const r = 4 + 2 * 12 + 2
    expect(String(sheet.getCell(r, 4).value)).toContain('Анатомия')
    expect(String(sheet.getCell(r + 1, 4).value)).toMatch(/^[А-Яа-я]+ [А-Я]\.$/)
  })

  it('pageSetup: A4 альбомная, 4×3 страницы, область печати, закрепление', () => {
    expect(sheet.pageSetup).toMatchObject({ paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 4, fitToHeight: 3 })
    expect(sheet.pageSetup.printArea).toMatch(/^A1:D\d+$/)
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 3, ySplit: 3 })
  })
})
