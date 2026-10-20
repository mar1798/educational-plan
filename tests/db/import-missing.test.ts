import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OperationDependedError, runOperation, undoOperation } from '../../src/main/db/repo/operations'
import { applyTeachingLoadRows } from '../../src/main/import/apply'
import { createMissingReferences, previewMissingReferences } from '../../src/main/import/missing'
import * as schema from '../../src/main/db/schema'
import { seedEmptyYear } from './annual-load-fixtures'
import { createTestDb, seedMinimalWorld } from './helpers'

const row = (over: Record<string, string | number | null> = {}) => ({
  teacherName: 'Янхаева З.',
  groupName: 'СД-21',
  disciplineName: 'Хирургия',
  lessonKind: 'Лек.',
  hoursPlanned: 24,
  halfYear: 'I',
  studentsCount: 21,
  ...over,
})

describe('«Завести недостающее» для нагрузки из файла', () => {
  let ctx: ReturnType<typeof createTestDb>

  beforeEach(() => {
    ctx = createTestDb()
  })

  afterEach(() => {
    ctx.sqlite.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('не заводит группу с разной численностью в файле, пока завуч не выберет (решения п. 43)', () => {
    const { sem1 } = seedEmptyYear(ctx.db)
    const report = previewMissingReferences(ctx.db, sem1, [row(), row({ studentsCount: 22, lessonKind: 'Практ.' })], '2026-10-20')
    expect(report.groups).toEqual([])
    expect(report.problems).toEqual([expect.stringContaining('численность в файле расходится (21 в 1 строках, 22 в 1 строках)')])
  })

  it('без численности в файле заводит группу с 25 и помечает это', () => {
    const { sem1 } = seedEmptyYear(ctx.db)
    const report = previewMissingReferences(ctx.db, sem1, [row({ studentsCount: null })], '2026-10-20')
    expect(report.groups).toEqual([expect.objectContaining({ name: 'СД-21', studentsCount: 25, studentsCountDefaulted: true })])
  })

  it('называет то, что завести нельзя: имя группы и семестр за сроком обучения', () => {
    const { sem1 } = seedEmptyYear(ctx.db)
    const report = previewMissingReferences(
      ctx.db,
      sem1,
      [row({ groupName: 'Хирургия-доп' }), row({ groupName: 'СД-41', halfYear: 'I' }), row({ teacherName: 'Мамралиева' })],
      '2026-10-20',
    )
    expect(report.problems).toEqual([
      expect.stringContaining('группа «Хирургия-доп»: не разобрать имя'),
      expect.stringContaining('группа «СД-41»: 7-й семестр больше срока обучения специальности (6)'),
      expect.stringContaining('преподаватель «Мамралиева»: не удалось разобрать фамилию и имя'),
    ])
    // Отброшенные строки ничего не заводят: ни группу «СД-41», ни их преподавателя.
    expect(report.groups.map((g) => g.name)).toEqual(['СД-21'])
    expect(report.teachers).toEqual([])
  })

  it('не заводит вторую квалификацию, если имеющаяся действует на дату импорта', () => {
    const world = seedMinimalWorld(ctx.db)
    ctx.db.update(schema.studyGroup).set({ name: 'СД-11' }).run()
    // Квалификация начинается после начала учебного года, но до даты импорта.
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId, disciplineId: world.disciplineId, validFrom: '2026-10-01' }).run()
    const rows = [row({ teacherName: 'Иванова Т.', groupName: 'СД-11', disciplineName: 'Анатомия', studentsCount: null })]
    expect(previewMissingReferences(ctx.db, world.semesterId, rows, '2026-10-20').qualifications).toEqual([])
  })

  it('берёт существующие записи и заводит только недостающую квалификацию', () => {
    const world = seedMinimalWorld(ctx.db)
    // В минимальном мире: Иванова Т, группа «11 СД» (1 курс, набор 2026), Анатомия в плане на 1-й семестр.
    ctx.db.update(schema.studyGroup).set({ name: 'СД-11' }).run()
    const rows = [row({ teacherName: 'Иванова Т.', groupName: 'СД-11', disciplineName: 'анатомия', studentsCount: null })]
    const report = previewMissingReferences(ctx.db, world.semesterId, rows, '2026-09-01')
    expect(report).toEqual({
      specialities: [],
      disciplines: [],
      teachers: [],
      groups: [],
      curricula: [],
      curriculumRows: [],
      qualifications: [{ teacher: 'Иванова Т', disciplineName: 'Анатомия' }],
      problems: [],
    })
    expect(createMissingReferences(ctx.db, world.semesterId, rows, '2026-09-01')).toBe(1)
    expect(previewMissingReferences(ctx.db, world.semesterId, rows, '2026-09-01').qualifications).toEqual([])
  })

  it('строка плана получает часы по видам — максимум по группам одного плана', () => {
    const { sem1 } = seedEmptyYear(ctx.db)
    const rows = [
      row({ groupName: 'СД-21', hoursPlanned: 24 }),
      row({ groupName: 'СД-21', lessonKind: 'Практ.', hoursPlanned: 36 }),
      row({ groupName: 'СД-22', hoursPlanned: 18, studentsCount: 20 }),
    ]
    createMissingReferences(ctx.db, sem1, rows, '2026-10-20')
    const planRows = ctx.db.select().from(schema.curriculumRow).all()
    expect(planRows).toHaveLength(1)
    expect(planRows[0]).toMatchObject({ course: 2, semesterNo: 3, hoursTheory: 24, hoursPractice: 36, hoursClassroom: 60, credits: 2, validFrom: '2026-09-01' })
    expect(ctx.db.select().from(schema.curriculum).all().map((c) => [c.name, c.admissionYear, c.status])).toEqual([['СД, набор 2025', 2025, 'draft']])
  })
})

describe('откат «Завести недостающее» после импорта', () => {
  it('просит сначала отменить импорт, а после него откатывается чисто', () => {
    const ctx = createTestDb()
    try {
      const { sem1 } = seedEmptyYear(ctx.db)
      const rows = [row()]
      const created = runOperation(ctx.db, 'import', {}, (tx, operationId) => createMissingReferences(tx, sem1, rows, '2026-10-20', { operationId }))
      const imported = runOperation(ctx.db, 'import', {}, (tx, operationId) => applyTeachingLoadRows(tx, sem1, rows, '2026-10-20', { operationId }))
      expect(imported.result.created).toBe(1)

      expect(() => undoOperation(ctx.db, created.operationId)).toThrow(OperationDependedError)
      expect(ctx.db.select().from(schema.studyGroup).all()).toHaveLength(1)

      undoOperation(ctx.db, imported.operationId)
      undoOperation(ctx.db, created.operationId)
      expect(ctx.db.select().from(schema.studyGroup).all()).toEqual([])
      expect(ctx.db.select().from(schema.teacher).all()).toEqual([])
      expect(ctx.db.select().from(schema.curriculumRow).all()).toEqual([])
    } finally {
      ctx.sqlite.close()
      rmSync(ctx.dir, { recursive: true, force: true })
    }
  })
})
