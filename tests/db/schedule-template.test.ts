import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runOperation, undoOperation } from '../../src/main/db/repo/operations'
import {
  activateTemplate,
  applyRollout,
  createTemplate,
  deleteTemplate,
  LockedEntryError,
  ScheduleConflictError,
  moveEntry,
  placeEntry,
  planRollout,
  removeEntry,
  setEntryLocked,
  templateEntriesView,
} from '../../src/main/db/repo/schedule-template'
import * as schema from '../../src/main/db/schema'
import { ReferencedError } from '../../src/main/db/repo/reference-guard'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('шаблон расписания: версии, конфликты, закрепление, раскатка (§4)', () => {
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

  it('создаёт v1, копирует в v2 «с 3-й недели», активация v2 закрывает v1 (4.1)', () => {
    const v1 = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    expect(v1.versionNo).toBe(1)
    placeEntry(ctx.db, { templateId: v1.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: world.roomId })

    const v2 = createTemplate(ctx.db, {
      semesterId: world.semesterId,
      effectiveFrom: '2026-09-15',
      note: 'с 3-й недели',
      copyFromTemplateId: v1.id as number,
    })
    expect(v2.versionNo).toBe(2)
    expect(templateEntriesView(ctx.db, v2.id as number)).toHaveLength(1)

    activateTemplate(ctx.db, v1.id as number, v1.rowVersion as number, {})
    activateTemplate(ctx.db, v2.id as number, v2.rowVersion as number, {})

    const v1After = ctx.db.select().from(schema.scheduleTemplate).where(eq(schema.scheduleTemplate.id, v1.id as number)).get()!
    expect(v1After.effectiveTo).toBe('2026-09-14')
  })

  it('обход прямым вызовом репозитория с конфликтом преподавателя отклоняется (4.5)', () => {
    const groupId2 = ctx.db
      .insert(schema.studyGroup)
      .values({ name: '12 СД', specialityId: world.specialityId, admissionYear: 2026, course: 1, studentsCount: 20, funding: 'budget', validFrom: '2026-01-01' })
      .returning({ id: schema.studyGroup.id })
      .get().id
    const teachingLoadId2 = ctx.db
      .insert(schema.teachingLoad)
      .values({ semesterId: world.semesterId, curriculumRowId: world.curriculumRowId, teacherId: world.teacherId, groupId: groupId2, lessonKind: 'theory', hoursPlanned: 80, validFrom: '2026-01-01' })
      .returning({ id: schema.teachingLoad.id })
      .get().id

    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: null })

    expect(() =>
      placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: teachingLoadId2, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: null }),
    ).toThrow(ScheduleConflictError)
  })

  it('пересекающиеся подгруппы конфликтуют, непересекающиеся — нет (§4.6)', () => {
    const schemeA = ctx.db
      .insert(schema.divisionScheme)
      .values({ groupId: world.groupId, semesterId: world.semesterId, name: 'Клинические', partsCount: 2, isDefault: false, validFrom: '2026-01-01' })
      .returning({ id: schema.divisionScheme.id })
      .get().id
    const clin1 = ctx.db
      .insert(schema.subgroup)
      .values({ groupId: world.groupId, schemeId: schemeA, no: 1, posFrom: 1, posTo: 10, validFrom: '2026-01-01' })
      .returning({ id: schema.subgroup.id })
      .get().id

    const schemeB = ctx.db
      .insert(schema.divisionScheme)
      .values({ groupId: world.groupId, semesterId: world.semesterId, name: 'Языки', partsCount: 2, isDefault: false, validFrom: '2026-01-01' })
      .returning({ id: schema.divisionScheme.id })
      .get().id
    const lang1 = ctx.db
      .insert(schema.subgroup)
      .values({ groupId: world.groupId, schemeId: schemeB, no: 1, posFrom: 1, posTo: 15, validFrom: '2026-01-01' })
      .returning({ id: schema.subgroup.id })
      .get().id
    const lang2 = ctx.db
      .insert(schema.subgroup)
      .values({ groupId: world.groupId, schemeId: schemeB, no: 2, posFrom: 16, posTo: 25, validFrom: '2026-01-01' })
      .returning({ id: schema.subgroup.id })
      .get().id

    const loadClin1 = ctx.db
      .insert(schema.teachingLoad)
      .values({ semesterId: world.semesterId, curriculumRowId: world.curriculumRowId, teacherId: world.teacherId, groupId: world.groupId, divisionSchemeId: schemeA, subgroupId: clin1, lessonKind: 'practice', hoursPlanned: 40, validFrom: '2026-01-01' })
      .returning({ id: schema.teachingLoad.id })
      .get().id
    const loadLang1 = ctx.db
      .insert(schema.teachingLoad)
      .values({ semesterId: world.semesterId, curriculumRowId: world.curriculumRowId, teacherId: world.teacherId2, groupId: world.groupId, divisionSchemeId: schemeB, subgroupId: lang1, lessonKind: 'practice', hoursPlanned: 40, validFrom: '2026-01-01' })
      .returning({ id: schema.teachingLoad.id })
      .get().id
    const loadLang2 = ctx.db
      .insert(schema.teachingLoad)
      .values({ semesterId: world.semesterId, curriculumRowId: world.curriculumRowId, teacherId: world.teacherId2, groupId: world.groupId, divisionSchemeId: schemeB, subgroupId: lang2, lessonKind: 'practice', hoursPlanned: 40, validFrom: '2026-01-01' })
      .returning({ id: schema.teachingLoad.id })
      .get().id

    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: loadClin1, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: null })

    // клин. п/гр1 [1-10] ∩ англ. п/гр1 [1-15] — пересечение
    expect(() =>
      placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: loadLang1, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: null }),
    ).toThrow(ScheduleConflictError)

    // клин. п/гр1 [1-10] ∩ англ. п/гр2 [16-25] — свободно, разрешено
    expect(() =>
      placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: loadLang2, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: null }),
    ).not.toThrow()
  })

  it('закреплённое занятие нельзя снять и нельзя перенести без снятия закрепления', () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    const entry = placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: null })

    const locked = setEntryLocked(ctx.db, entry.id as number, entry.rowVersion as number, true)
    expect(() => removeEntry(ctx.db, entry.id as number, locked.rowVersion as number)).toThrow(LockedEntryError)
    expect(() => moveEntry(ctx.db, { id: entry.id as number, rowVersion: locked.rowVersion as number, dayOfWeek: 3, pairNo: 1, weekParity: 'all', roomId: null })).toThrow(
      LockedEntryError,
    )

    const unlocked = setEntryLocked(ctx.db, entry.id as number, locked.rowVersion as number, false)
    expect(() => removeEntry(ctx.db, entry.id as number, unlocked.rowVersion as number)).not.toThrow()
  })

  it('удаление версии уносит её записи и откатывается целиком (4.1)', () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: world.roomId })

    const { operationId } = runOperation(ctx.db, 'bulk_edit', {}, (tx, opId) =>
      deleteTemplate(tx, tmpl.id as number, tmpl.rowVersion as number, { operationId: opId }),
    )

    expect(ctx.db.select().from(schema.scheduleTemplate).where(eq(schema.scheduleTemplate.id, tmpl.id as number)).all()).toHaveLength(0)
    expect(ctx.db.select().from(schema.templateEntry).where(eq(schema.templateEntry.templateId, tmpl.id as number)).all()).toHaveLength(0)

    undoOperation(ctx.db, operationId)
    expect(templateEntriesView(ctx.db, tmpl.id as number)).toHaveLength(1)
  })

  it('версию с уже раскатанными занятиями удалить нельзя (4.1, 4.10)', () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: world.roomId })
    const plan = planRollout(ctx.db, { templateId: tmpl.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-01' })
    const { operationId } = runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, plan, { operationId: opId }))

    expect(() => ctx.db.transaction((tx) => deleteTemplate(tx, tmpl.id as number, tmpl.rowVersion as number))).toThrow(ReferencedError)

    // После отката раскатки версия удаляется штатно — это и есть подсказанный пользователю путь.
    undoOperation(ctx.db, operationId)
    expect(() => ctx.db.transaction((tx) => deleteTemplate(tx, tmpl.id as number, tmpl.rowVersion as number))).not.toThrow()
  })

  it('версию, с которой скопирована другая, удалить нельзя (4.1)', () => {
    const v1 = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-15', note: null, copyFromTemplateId: v1.id as number })

    expect(() => ctx.db.transaction((tx) => deleteTemplate(tx, v1.id as number, v1.rowVersion as number))).toThrow(ReferencedError)
  })

  it('раскатка не раньше effective_from шаблона (4.10)', () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-08', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: null })

    const plan = planRollout(ctx.db, { templateId: tmpl.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-08' })
    expect(plan.dateFrom).toBe('2026-09-08')
    expect(plan.toCreate).toBe(1)
  })

  it('праздник пропускает занятие, held-занятие не трогается при повторной раскатке (4.8, 4.10)', () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: world.roomId })

    ctx.db.insert(schema.calendarDay).values({ date: '2026-09-08', semesterId: world.semesterId, kind: 'holiday' }).run()

    const firstPlan = planRollout(ctx.db, { templateId: tmpl.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-08' })
    expect(firstPlan.toCreate).toBe(1) // только 2026-09-01, вторник 09-08 — праздник

    const { operationId } = runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, firstPlan, { operationId: opId }))

    const createdLesson = ctx.db.select().from(schema.lesson).where(eq(schema.lesson.date, '2026-09-01')).get()!
    ctx.db.update(schema.lesson).set({ status: 'held' }).where(eq(schema.lesson.id, createdLesson.id)).run()

    // Меняем кабинет в шаблоне после того, как занятие уже проведено — held не должно измениться.
    const entryRow = ctx.db.select().from(schema.templateEntry).where(eq(schema.templateEntry.templateId, tmpl.id as number)).get()!
    moveEntry(ctx.db, { id: entryRow.id, rowVersion: entryRow.rowVersion, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: world.roomId2 })

    const secondPlan = planRollout(ctx.db, { templateId: tmpl.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-08' })
    expect(secondPlan.toCreate).toBe(0)
    expect(secondPlan.toUpdate).toBe(0)
    expect(secondPlan.toCancel).toBe(0)

    undoOperation(ctx.db, operationId)
    expect(ctx.db.select().from(schema.lesson).where(eq(schema.lesson.date, '2026-09-08')).all()).toHaveLength(0)
  })

  it('период практики отменяет уже поставленное занятие на диапазон (4.8)', () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: null })

    const firstPlan = planRollout(ctx.db, { templateId: tmpl.id as number, dateFrom: '2026-09-08', dateTo: '2026-09-08' })
    expect(firstPlan.toCreate).toBe(1)
    runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, firstPlan, { operationId: opId }))
    expect(ctx.db.select().from(schema.lesson).where(eq(schema.lesson.date, '2026-09-08')).all()).toHaveLength(1)

    ctx.db.insert(schema.calendarPeriod).values({ kind: 'practice', course: null, specialityId: null, groupId: world.groupId, startsOn: '2026-09-08', endsOn: '2026-09-14' }).run()

    const secondPlan = planRollout(ctx.db, { templateId: tmpl.id as number, dateFrom: '2026-09-08', dateTo: '2026-09-08' })
    expect(secondPlan.toCancel).toBe(1)
    runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, secondPlan, { operationId: opId }))

    const lessonAfter = ctx.db.select().from(schema.lesson).where(eq(schema.lesson.date, '2026-09-08')).get()!
    expect(lessonAfter.status).toBe('cancelled')
  })
  it('перенос записи в шаблоне: повторная раскатка отменяет занятие на прежнем дне (4.8, 4.9)', () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    const entry = placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: null })

    const first = planRollout(ctx.db, { templateId: tmpl.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-09' })
    expect(first.toCreate).toBe(2) // вторники 09-01 и 09-08
    runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, first, { operationId: opId }))

    const entryRow = ctx.db.select().from(schema.templateEntry).where(eq(schema.templateEntry.id, entry.id as number)).get()!
    moveEntry(ctx.db, { id: entryRow.id, rowVersion: entryRow.rowVersion, dayOfWeek: 3, pairNo: 1, weekParity: 'all', roomId: null })

    const second = planRollout(ctx.db, { templateId: tmpl.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-09' })
    expect(second.toCreate).toBe(2) // среды 09-02 и 09-09
    expect(second.toCancel).toBe(2) // осиротевшие вторники
    runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, second, { operationId: opId }))

    const statuses = ctx.db.select().from(schema.lesson).all().map((l) => `${l.date}:${l.status}`).sort()
    expect(statuses).toEqual(['2026-09-01:cancelled', '2026-09-02:planned', '2026-09-08:cancelled', '2026-09-09:planned'])
  })

  it('снятая из шаблона запись отменяет своё занятие при следующей раскатке (4.9)', () => {
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    const entry = placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: null })

    const first = planRollout(ctx.db, { templateId: tmpl.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-01' })
    runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, first, { operationId: opId }))

    const entryRow = ctx.db.select().from(schema.templateEntry).where(eq(schema.templateEntry.id, entry.id as number)).get()!
    removeEntry(ctx.db, entryRow.id, entryRow.rowVersion)

    const second = planRollout(ctx.db, { templateId: tmpl.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-01' })
    expect(second.toCancel).toBe(1)
    runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, second, { operationId: opId }))

    expect(ctx.db.select().from(schema.lesson).get()!.status).toBe('cancelled')
  })

  it('раскатка новой версии подхватывает занятия прежней, а не дублирует их (4.1, 4.8)', () => {
    const v1 = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: v1.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: null })
    const planV1 = planRollout(ctx.db, { templateId: v1.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-08' })
    runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, planV1, { operationId: opId }))

    const v2 = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-08', note: null, copyFromTemplateId: v1.id as number })
    const planV2 = planRollout(ctx.db, { templateId: v2.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-08' })
    expect(planV2.toCreate).toBe(0)
    expect(planV2.toCancel).toBe(0)
    expect(planV2.toUpdate).toBe(1) // занятие 09-08 переходит к новой версии
    runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, planV2, { operationId: opId }))

    const lessons = ctx.db.select().from(schema.lesson).where(eq(schema.lesson.date, '2026-09-08')).all()
    expect(lessons).toHaveLength(1)
    expect(lessons[0]!.templateId).toBe(v2.id)
  })

  it('чётность недели отсчитывается от понедельника недели начала семестра (§1.1)', () => {
    // Семестр начинается во вторник 2026-09-01, значит неделя 1 (нечётная) — это 08-31…09-06,
    // и понедельник 09-07 попадает уже в чётную неделю.
    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 1, pairNo: 1, weekParity: 'odd', roomId: null })

    const plan = planRollout(ctx.db, { templateId: tmpl.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-14' })
    expect(plan.items.map((i) => i.date)).toEqual(['2026-09-14'])
  })

  it('текст конфликта называет, чем занят слот (4.4)', () => {
    const teachingLoadId2 = ctx.db
      .insert(schema.teachingLoad)
      .values({ semesterId: world.semesterId, curriculumRowId: world.curriculumRowId, teacherId: world.teacherId, groupId: world.groupId, lessonKind: 'seminar', hoursPlanned: 40, validFrom: '2026-01-01' })
      .returning({ id: schema.teachingLoad.id })
      .get().id

    const tmpl = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: null })

    try {
      placeEntry(ctx.db, { templateId: tmpl.id as number, teachingLoadId: teachingLoadId2, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: null })
      expect.unreachable('ожидался конфликт')
    } catch (e) {
      expect((e as Error).message).toContain('Иванова Т. ведёт в это время 11 СД («Анатомия»)')
    }
  })
})
