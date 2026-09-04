import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  computeEvenWeeklyHours,
  copyCurriculum,
  countAffectedLessons,
  createCurriculumRow,
  deleteCurriculum,
  deleteCurriculumRowCascade,
  editCurriculumRow,
  generateCurriculumWeeks,
  listCurriculumWeeks,
  updateCurriculumWeeks,
} from '../../src/main/db/repo/curriculum'
import { applyCurriculumRows } from '../../src/main/import/apply'
import { ensureDeletable, ReferencedError } from '../../src/main/db/repo/reference-guard'
import { runOperation, undoOperation } from '../../src/main/db/repo/operations'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('равномерное распределение часов по неделям (§3.4)', () => {
  it('делит 80 часов на 18 недель, остаток — в первые недели', () => {
    const weeks = computeEvenWeeklyHours(80, 18)
    expect(weeks).toHaveLength(18)
    expect(weeks.reduce((sum, w) => sum + w.hours, 0)).toBe(80)
    expect(weeks[0]!.hours).toBeGreaterThanOrEqual(weeks[17]!.hours)
  })

  it('делит без остатка ровно', () => {
    expect(computeEvenWeeklyHours(36, 18)).toEqual(Array.from({ length: 18 }, (_, i) => ({ weekNo: i + 1, hours: 2 })))
  })
})

const rowFields = {
  disciplineId: 0,
  course: 1,
  semesterNo: 2,
  credits: 3,
  hoursTotal: 90,
  hoursClassroom: 60,
  hoursTheory: 30,
  hoursPractice: 30,
  hoursSeminar: 0,
  hoursLab: 0,
  hoursSrs: 30,
  controlSemester: null as number | null,
}

describe('учебный план: строки, версионирование, копирование, недели (§3.1–3.4)', () => {
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

  it('правка строки в черновом плане обновляет строку на месте, без версии', () => {
    const created = createCurriculumRow(ctx.db, world.curriculumId, { ...rowFields, disciplineId: world.disciplineId }, '2026-01-01')
    const { row, versioned } = editCurriculumRow(
      ctx.db,
      created.id as number,
      { credits: 4, hoursTotal: 120 },
      created.rowVersion as number,
      '2026-02-01',
    )
    expect(versioned).toBe(false)
    expect(row.id).toBe(created.id)
    expect(row.credits).toBe(4)

    const rows = ctx.db.select().from(schema.curriculumRow).where(eq(schema.curriculumRow.id, created.id as number)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.credits).toBe(4)
  })

  it('правка строки утверждённого плана закрывает старую строку и создаёт новую версию с supersedesId', () => {
    const created = createCurriculumRow(ctx.db, world.curriculumId, { ...rowFields, disciplineId: world.disciplineId }, '2026-01-01')
    ctx.db.update(schema.curriculum).set({ status: 'approved' }).where(eq(schema.curriculum.id, world.curriculumId)).run()

    const { row, versioned } = editCurriculumRow(
      ctx.db,
      created.id as number,
      { credits: 5 },
      created.rowVersion as number,
      '2026-03-01',
    )
    expect(versioned).toBe(true)
    expect(row.supersedesId).toBe(created.id)
    expect(row.credits).toBe(5)

    const old = ctx.db.select().from(schema.curriculumRow).where(eq(schema.curriculumRow.id, created.id as number)).get()!
    expect(old.validTo).toBe('2026-03-01')
  })

  it('копирует план в новый черновик со всеми активными строками, без раскладки по неделям', () => {
    const created = createCurriculumRow(ctx.db, world.curriculumId, { ...rowFields, disciplineId: world.disciplineId }, '2026-01-01')
    generateCurriculumWeeks(ctx.db, created.id as number, 18)

    const copy = copyCurriculum(ctx.db, world.curriculumId, { specialityId: world.specialityId, admissionYear: 2027, name: 'СД 2027' })
    expect(copy.status).toBe('draft')
    expect(copy.admissionYear).toBe(2027)

    // seedMinimalWorld уже завёл одну строку в этом же плане — копия переносит обе активные строки.
    const copiedRows = ctx.db.select().from(schema.curriculumRow).where(eq(schema.curriculumRow.curriculumId, copy.id as number)).all()
    expect(copiedRows).toHaveLength(2)
    const copiedRow = copiedRows.find((r) => r.credits === rowFields.credits)!
    expect(copiedRow).toBeDefined()

    const copiedWeeks = listCurriculumWeeks(ctx.db, copiedRow.id)
    expect(copiedWeeks).toHaveLength(0)
  })

  it('генерирует недельную раскладку суммой в hoursClassroom и позволяет править её вручную', () => {
    const created = createCurriculumRow(ctx.db, world.curriculumId, { ...rowFields, disciplineId: world.disciplineId, hoursClassroom: 36 }, '2026-01-01')
    const weeks = generateCurriculumWeeks(ctx.db, created.id as number, 18)
    expect(weeks.reduce((sum, w) => sum + w.hours, 0)).toBe(36)

    const edited = updateCurriculumWeeks(
      ctx.db,
      created.id as number,
      weeks.map((w) => (w.weekNo === 1 ? { id: w.id, rowVersion: w.rowVersion, hours: w.hours + 1 } : { id: w.id, rowVersion: w.rowVersion, hours: w.hours })),
    )
    expect(edited.find((w) => w.weekNo === 1)!.hours).toBe(3)
  })

  it('блокирует правку недель с несовпадающим числом строк', () => {
    const created = createCurriculumRow(ctx.db, world.curriculumId, { ...rowFields, disciplineId: world.disciplineId }, '2026-01-01')
    const weeks = generateCurriculumWeeks(ctx.db, created.id as number, 18)
    expect(() => updateCurriculumWeeks(ctx.db, created.id as number, weeks.slice(0, 5))).toThrow()
  })

  it('удаление строки плана блокируется, если на неё ссылается нагрузка', () => {
    expect(() =>
      ensureDeletable(ctx.db, `Строка плана #${world.curriculumRowId}`, world.curriculumRowId, [
        { table: schema.teachingLoad, column: schema.teachingLoad.curriculumRowId, nounRu: 'нагрузке' },
      ]),
    ).toThrow(ReferencedError)
  })

  it('удаление строки плана уносит её недельную раскладку', () => {
    const created = createCurriculumRow(ctx.db, world.curriculumId, { ...rowFields, disciplineId: world.disciplineId, hoursClassroom: 36 }, '2026-01-01')
    generateCurriculumWeeks(ctx.db, created.id as number, 18)

    ctx.db.transaction((tx) => deleteCurriculumRowCascade(tx, created.id as number))

    expect(listCurriculumWeeks(ctx.db, created.id as number)).toHaveLength(0)
    expect(ctx.db.select().from(schema.curriculumRow).where(eq(schema.curriculumRow.id, created.id as number)).all()).toHaveLength(0)
  })

  it('удаление плана блокируется розданной нагрузкой и проходит после её снятия, с откатом целиком', () => {
    expect(() => ctx.db.transaction((tx) => deleteCurriculum(tx, world.curriculumId))).toThrow(ReferencedError)

    ctx.db.delete(schema.teachingLoad).where(eq(schema.teachingLoad.curriculumRowId, world.curriculumRowId)).run()
    const { operationId } = runOperation(ctx.db, 'bulk_edit', {}, (tx, opId) => deleteCurriculum(tx, world.curriculumId, { operationId: opId }))

    expect(ctx.db.select().from(schema.curriculum).where(eq(schema.curriculum.id, world.curriculumId)).all()).toHaveLength(0)
    expect(ctx.db.select().from(schema.curriculumRow).where(eq(schema.curriculumRow.curriculumId, world.curriculumId)).all()).toHaveLength(0)

    undoOperation(ctx.db, operationId)
    expect(ctx.db.select().from(schema.curriculumRow).where(eq(schema.curriculumRow.curriculumId, world.curriculumId)).all()).toHaveLength(1)
  })

  it('считает занятия, затронутые правкой строки плана, начиная с даты', () => {
    expect(countAffectedLessons(ctx.db, world.curriculumRowId, '2026-01-01')).toBe(0)

    ctx.db
      .insert(schema.lesson)
      .values({
        date: '2026-09-10',
        pairNo: 1,
        teachingLoadId: world.teachingLoadId,
        teacherId: world.teacherId,
        disciplineId: world.disciplineId,
        lessonKind: 'theory',
        operationId: world.operationId,
      })
      .run()
    ctx.db
      .insert(schema.lesson)
      .values({
        date: '2026-08-01',
        pairNo: 1,
        teachingLoadId: world.teachingLoadId,
        teacherId: world.teacherId,
        disciplineId: world.disciplineId,
        lessonKind: 'theory',
        operationId: world.operationId,
      })
      .run()

    expect(countAffectedLessons(ctx.db, world.curriculumRowId, '2026-09-01')).toBe(1)
    expect(countAffectedLessons(ctx.db, world.curriculumRowId, '2026-01-01')).toBe(2)
  })

  it('быстрый ввод из буфера (§3.10) — вставленные строки откатываются одной операцией', () => {
    const { operationId, result } = runOperation(ctx.db, 'bulk_edit', {}, (tx, operationId) =>
      applyCurriculumRows(
        tx,
        world.curriculumId,
        [{ disciplineName: 'Анатомия', course: 2, semesterNo: 3, credits: 2, hoursTotal: 60, hoursClassroom: 40 }],
        '2026-01-01',
        { operationId },
      ),
    )
    expect(result.created).toBe(1)
    const inserted = ctx.db.select().from(schema.curriculumRow).where(eq(schema.curriculumRow.semesterNo, 3)).all()
    expect(inserted).toHaveLength(1)

    undoOperation(ctx.db, operationId)
    const afterUndo = ctx.db.select().from(schema.curriculumRow).where(eq(schema.curriculumRow.semesterNo, 3)).all()
    expect(afterUndo).toHaveLength(0)
  })
})
