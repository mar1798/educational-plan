import { and, eq, isNull } from 'drizzle-orm'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyTeachingLoadRows } from '../../src/main/import/apply'
import { createMissingReferences, previewMissingReferences } from '../../src/main/import/missing'
import { listSheets, readSheetGrid } from '../../src/main/import/workbook'
import { onboardingStatus } from '../../src/main/db/repo/onboarding'
import * as schema from '../../src/main/db/schema'
import type { Db } from '../../src/main/db/client'
import { applyBlockHeaders, coveredFields, guessColumnConstants, TARGET_SCHEMAS, type Cell, type Grid } from '../../src/shared/import/engine'
import { annualLoadMapping, buildRecords, COL, mostFrequent, seedEmptyYear, writeAnnualLoadWorkbook } from './annual-load-fixtures'
import { createTestDb } from './helpers'

// Сквозной регресс по фидбеку «у меня всё по столбцам»: годовая нагрузка колледжа —
// «широкая» таблица (часы по видам занятий и полугодиям в колонках), преподаватель и
// дисциплина — строками-заголовками над блоком групп, шапка в три уровня из объединённых
// ячеек. Путь тот же, что у завуча в онбординге: пустая база → готовый профиль мастера →
// «Завести недостающее» (missing.ts) → применение (apply.ts).

function activeLoads(db: Db, semesterId: number) {
  return db
    .select()
    .from(schema.teachingLoad)
    .where(and(eq(schema.teachingLoad.semesterId, semesterId), isNull(schema.teachingLoad.validTo)))
    .all()
}

// ─────────────────────────────────────────────────────────────────────────────────────────

describe('импорт годовой нагрузки: «широкая» таблица со строками-заголовками', () => {
  let ctx: ReturnType<typeof createTestDb>
  let dir: string

  beforeEach(() => {
    ctx = createTestDb()
    dir = mkdtempSync(join(tmpdir(), 'eduplan-annual-'))
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  })

  it('разворачивает часы по видам и полугодиям и раскладывает их по семестрам', async () => {
    const path = join(dir, 'annual.xlsx')
    await writeAnnualLoadWorkbook(path)
    const grid = await readSheetGrid(path, 'Бюджет')
    const { hints, columns, blocks, discrepancies, records } = buildRecords(grid, annualLoadMapping)

    // Признаки колонок в поставляемом профиле — те же, что мастер подставил бы из шапки сам.
    expect(hints[COL.G]).toBe('Нагрузка / Лек. / I полугодие')
    expect(hints[COL.N]).toBe('Нагрузка / Практ., семин., лаб. / II полугодие')
    for (const c of [COL.G, COL.H, COL.M, COL.N]) {
      expect(columns.find((x) => x.columnIndex === c)?.constants).toEqual(guessColumnConstants(hints[c]!))
    }
    const required = TARGET_SCHEMAS.teaching_load.filter((f) => f.required).map((f) => f.field)
    const covered = coveredFields(columns, annualLoadMapping.headerRules ?? [])
    expect(required.filter((f) => !covered.has(f))).toEqual([])

    expect(blocks.headerRows).toHaveLength(5)
    expect(discrepancies).toEqual([])
    const base = { studentsCount: 20 }
    // Общий итог под таблицей (без подписи, за последней строкой) записью не стал.
    expect(records).toEqual([
      { ...base, disciplineName: 'Хирургия', teacherName: 'Янхаева З.', groupName: 'СД-21', hoursPlanned: 24, lessonKind: 'Лек.', halfYear: 'II' },
      { ...base, disciplineName: 'Хирургия', teacherName: 'Янхаева З.', groupName: 'СД-21', hoursPlanned: 36, lessonKind: 'Практ.', halfYear: 'II' },
      { ...base, disciplineName: 'Хирургия', teacherName: 'Янхаева З.', groupName: 'СД-31 ', hoursPlanned: 12, lessonKind: 'Лек.', halfYear: 'I' },
      { ...base, disciplineName: 'Хирургия', teacherName: 'Янхаева З.', groupName: 'СД-31 ', hoursPlanned: 33, lessonKind: 'Практ.', halfYear: 'I' },
      { ...base, disciplineName: 'Хирургия', teacherName: 'Янхаева З.', groupName: 'СД-31 ', hoursPlanned: 12, lessonKind: 'Лек.', halfYear: 'II' },
      { ...base, disciplineName: 'Хирургия', teacherName: 'Янхаева З.', groupName: 'СД-31 ', hoursPlanned: 33, lessonKind: 'Практ.', halfYear: 'II' },
      { ...base, disciplineName: 'Хирургия', teacherName: 'Омуркул к. К.', groupName: 'АД-21', hoursPlanned: 18, lessonKind: 'Лек.', halfYear: 'I' },
      { ...base, disciplineName: 'Терапия', teacherName: 'Абдуллаева М.Н', groupName: 'СД-12', hoursPlanned: 12, lessonKind: 'Практ.', halfYear: 'I' },
      { ...base, disciplineName: 'Терапия', teacherName: 'Абдуллаева М.Н', groupName: 'СД-12', hoursPlanned: 12, lessonKind: 'Практ.', halfYear: 'I' },
    ])

    const { sem1, sem2 } = seedEmptyYear(ctx.db)
    const report = previewMissingReferences(ctx.db, sem1, records, '2026-10-20')
    expect(report.problems).toEqual([])
    expect(report.specialities.map((s) => s.code).sort()).toEqual(['АД', 'СД'])
    expect(report.disciplines.map((d) => d.name)).toEqual(['Хирургия', 'Терапия'])
    expect(report.teachers.map((t) => [t.lastName, t.firstName, t.middleName])).toEqual([
      ['Янхаева', 'З.', null],
      ['Омуркул кызы', 'К.', null],
      ['Абдуллаева', 'М.', 'Н.'],
    ])
    expect(report.groups).toEqual([
      { name: 'СД-21', specialityCode: 'СД', course: 2, admissionYear: 2025, funding: 'budget', studentsCount: 20, studentsCountDefaulted: false },
      { name: 'СД-31', specialityCode: 'СД', course: 3, admissionYear: 2024, funding: 'budget', studentsCount: 20, studentsCountDefaulted: false },
      { name: 'АД-21', specialityCode: 'АД', course: 2, admissionYear: 2025, funding: 'budget', studentsCount: 20, studentsCountDefaulted: false },
      { name: 'СД-12', specialityCode: 'СД', course: 1, admissionYear: 2026, funding: 'budget', studentsCount: 20, studentsCountDefaulted: false },
    ])
    // Строка плана СД-31 «Хирургия», семестр 5: лекции 12 + практика 33.
    expect(report.curriculumRows).toContainEqual({ curriculum: 'СД, набор 2024', disciplineName: 'Хирургия', course: 3, semesterNo: 5, hoursClassroom: 45 })
    expect(report.qualifications).toHaveLength(3)

    const created = createMissingReferences(ctx.db, sem1, records, '2026-10-20')
    expect(created).toBeGreaterThan(0)
    const after = previewMissingReferences(ctx.db, sem1, records, '2026-10-20')
    expect({ ...after, problems: [] }).toEqual({ specialities: [], disciplines: [], teachers: [], groups: [], curricula: [], curriculumRows: [], qualifications: [], problems: [] })

    const result = applyTeachingLoadRows(ctx.db, sem1, records, '2026-10-20')
    expect(result.skipped.map((s) => s.reason)).toEqual([expect.stringContaining('повтор в файле')])
    expect(result.created).toBe(8)
    expect(activeLoads(ctx.db, sem1).reduce((a, l) => a + l.hoursPlanned, 0)).toBe(12 + 33 + 18 + 12)
    expect(activeLoads(ctx.db, sem2).reduce((a, l) => a + l.hoursPlanned, 0)).toBe(24 + 36 + 12 + 33)

    // Повторная заливка того же файла (завуч поправил пару строк) не удваивает часы.
    const again = applyTeachingLoadRows(ctx.db, sem1, records, '2026-10-20')
    expect(again.created).toBe(0)
    expect(activeLoads(ctx.db, sem1)).toHaveLength(4)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// Настоящий файл колледжа в репозиторий не кладётся (решения п. 17, 47; ФИО людей) —
// тест берёт его из IMPORT_ANNUAL_LOAD_XLSX или из корня проекта и без файла пропускается.

const realFile = process.env.IMPORT_ANNUAL_LOAD_XLSX ?? resolve(__dirname, '../../Годовая нагрузка 2026-2027 Готов на 1 октября.xlsx')

describe.skipIf(!existsSync(realFile))('импорт годовой нагрузки: настоящий файл колледжа', () => {
  let ctx: ReturnType<typeof createTestDb>

  beforeEach(() => {
    ctx = createTestDb()
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it.each(['Бюджет', 'Контракт'])('лист «%s» загружается целиком: ни одного потерянного часа', async (sheet) => {
    expect((await listSheets(realFile)).map((s) => s.name)).toContain(sheet)
    const grid = await readSheetGrid(realFile, sheet)
    // Последняя строка данных — перед строкой общего итога без подписи.
    const totalRow = grid.findIndex((row, i) => i > 8 && row.slice(0, COL.F + 1).every((c) => c == null || String(c).trim() === '') && typeof row[COL.G] === 'number')
    expect(totalRow).toBeGreaterThan(0)
    // Профиль читает до конца листа: общий итог без подписи отсеивается сам.
    const first = buildRecords(grid, annualLoadMapping)
    expect(first.records.length).toBeGreaterThan(0)
    const { blocks, records } = buildRecords(grid, annualLoadMapping, mostFrequent(first.discrepancies))

    // Каждая строка данных — строка группы; ни одна не потерялась среди заголовков.
    // Колонки правее нагрузки не смотрим: на листе «Контракт» там отдельная сводная таблица.
    const groupLike = /^К?(СД|ЛД|АД|СО|Л|Ф)-\d\d$/
    const loadColumns = [COL.G, COL.H, COL.K, COL.M, COL.N, COL.Q]
    const dataWithHours = blocks.dataRows.filter((row) => loadColumns.some((c) => typeof row[c] === 'number'))
    expect(dataWithHours.every((row) => groupLike.test(String(row[COL.D]).trim()))).toBe(true)

    // Контрольные суммы листа: итог преподавателя в строке-заголовке — это «Итого» плюс
    // «Тест» по строкам его групп. Сходится по каждому блоку — значит, строки-заголовки
    // распознаны все, ни одна не попала в данные и ни одна строка группы не потерялась.
    const ranged = grid.slice(annualLoadMapping.dataStartRow - 1, totalRow)
    const { headerRows } = applyBlockHeaders(ranged, annualLoadMapping.headerRules ?? [])
    const n = (c: Cell | undefined) => (typeof c === 'number' ? c : 0)
    const sum = (rows: Grid, col: number) => rows.reduce((a, row) => a + n(row[col]), 0)
    const mismatches: { teacher: string; half: string; header: number; rows: number; test: number }[] = []
    let block: { name: string; row: Cell[]; items: Cell[][] } | null = null
    const check = () => {
      if (!block) return
      for (const [half, head, total, test] of [
        ['I', COL.G, COL.K, COL.L],
        ['II', COL.M, COL.Q, COL.R],
      ] as const) {
        const rows = block.items.reduce((a, r) => a + n(r[total]) + n(r[test]), 0)
        if (rows !== n(block.row[head])) {
          mismatches.push({ teacher: block.name, half, header: n(block.row[head]), rows, test: block.items.reduce((a, r) => a + n(r[test]), 0) })
        }
      }
    }
    for (const row of ranged) {
      if (!headerRows.includes(row)) {
        block?.items.push(row)
        continue
      }
      check()
      block = /^\d+$/.test(String(row[COL.B]).trim()) ? null : { name: String(row[COL.B]).trim(), row, items: [] }
    }
    check()
    // Файл «Готов на 1 октября» содержит одну собственную ошибку: итог Иманалиевой (стр. 238)
    // посчитан формулой SUM(Q239) без «Теста». Расхождение допустимо, только если оно ровно
    // на «Тест» блока, — любое другое означало бы потерянную или лишнюю строку.
    expect(mismatches.filter((m) => m.rows - m.header !== m.test)).toEqual([])

    // Записи несут все часы «Нагрузки» по своему полугодию.
    const recordHours = (half: string) => records.filter((r) => r.halfYear === half).reduce((a, r) => a + Number(r.hoursPlanned), 0)
    expect(recordHours('I')).toBe(sum(blocks.dataRows, COL.G) + sum(blocks.dataRows, COL.H))
    expect(recordHours('II')).toBe(sum(blocks.dataRows, COL.M) + sum(blocks.dataRows, COL.N))
    expect(records.every((r) => r.teacherName && r.disciplineName && r.groupName && r.lessonKind)).toBe(true)
    expect(records.some((r) => /^\d+$/.test(String(r.teacherName)))).toBe(false)

    // Онбординг: пустой учебный год → без справочников ни одна строка не легла бы →
    // «Завести недостающее» → применение.
    const { sem1, sem2 } = seedEmptyYear(ctx.db)
    expect(onboardingStatus(ctx.db).ready).toBe(false)
    // До выбора в «Проверке расхождений» группы с разной численностью не заводятся (п. 43).
    const unresolved = previewMissingReferences(ctx.db, sem1, first.records, '2026-10-20')
    expect(unresolved.problems.every((p) => p.includes('численность в файле расходится'))).toBe(true)
    expect(unresolved.problems).toHaveLength(first.discrepancies.length)

    expect(previewMissingReferences(ctx.db, sem1, records, '2026-10-20').problems).toEqual([])
    createMissingReferences(ctx.db, sem1, records, '2026-10-20')
    const result = applyTeachingLoadRows(ctx.db, sem1, records, '2026-10-20')

    // Пропускаются только подгруппы, записанные повторной строкой той же группы.
    expect(result.skipped.filter((s) => !s.reason.startsWith('повтор в файле'))).toEqual([])
    expect(result.created + result.skipped.length).toBe(records.length)
    const skippedHours = (half: string) => result.skipped.filter((s) => s.row.halfYear === half).reduce((a, s) => a + Number(s.row.hoursPlanned), 0)
    expect(activeLoads(ctx.db, sem1).reduce((a, l) => a + l.hoursPlanned, 0)).toBe(recordHours('I') - skippedHours('I'))
    expect(activeLoads(ctx.db, sem2).reduce((a, l) => a + l.hoursPlanned, 0)).toBe(recordHours('II') - skippedHours('II'))

    // После импорта онбординг видит справочники, планы, квалификации и нагрузку.
    const steps = Object.fromEntries(onboardingStatus(ctx.db).steps.map((st) => [st.key, st.status]))
    for (const key of ['calendar', 'specialities', 'disciplines', 'groups', 'teachers', 'curricula', 'qualifications', 'load']) {
      expect([key, steps[key]]).toEqual([key, 'done'])
    }
    // Книга на 2,5 МБ и почти тысячу строк: под параллельным прогоном одно чтение занимает секунды.
  }, 60_000)
})
