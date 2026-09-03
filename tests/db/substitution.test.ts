import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runOperation, undoOperation } from '../../src/main/db/repo/operations'
import { applyRollout, createTemplate, placeEntry, planRollout, ScheduleConflictError } from '../../src/main/db/repo/schedule-template'
import {
  applyCancelLesson,
  applyMoveLesson,
  applyTeacherSwap,
  listTeacherLessons,
  listTeacherSubstitutionHistory,
  rankSubstituteCandidates,
  SubstitutionValidationError,
} from '../../src/main/db/repo/substitution'
import { NotFoundError } from '../../src/main/db/repo/base-repo'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'

describe('замены: подбор кандидата, замена, отмена, перенос (§этап 7)', () => {
  let ctx: ReturnType<typeof createTestDb>
  let world: MinimalWorld
  let lessonId: number

  beforeEach(() => {
    ctx = createTestDb()
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

  it('listTeacherLessons отдаёт занятия преподавателя в диапазоне (задача этапа 7)', () => {
    const rows = listTeacherLessons(ctx.db, world.teacherId, '2026-09-01', '2026-09-01')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ lessonId, disciplineName: 'Анатомия', status: 'planned', hasSubstitution: false, handedOver: false })
    expect(listTeacherLessons(ctx.db, world.teacherId, '2026-09-02', '2026-09-08')).toHaveLength(0)
    expect(listTeacherLessons(ctx.db, world.teacherId2, '2026-09-01', '2026-09-01')).toHaveLength(0)
  })

  it('rankSubstituteCandidates исключает неквалифицированных и с hard-недоступностью, ранжирует по недобору часов (задача этапа 7)', () => {
    // Без квалификации teacherId2 не попадает в список.
    expect(rankSubstituteCandidates(ctx.db, lessonId)).toHaveLength(0)

    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId2, disciplineId: world.disciplineId, validFrom: '2026-01-01' }).run()

    const withQualification = rankSubstituteCandidates(ctx.db, lessonId)
    expect(withQualification).toHaveLength(1)
    expect(withQualification[0]).toMatchObject({ teacherId: world.teacherId2, isFree: true, normHoursYear: 720, assignedHoursYear: 0, shortfallHours: 720 })

    // Hard-недоступность по дню недели (вторник = dayOfWeek 2, §2, WEEKDAY_LABEL) исключает кандидата целиком.
    ctx.db
      .insert(schema.teacherAbsence)
      .values({ teacherId: world.teacherId2, kind: 'hard', scope: 'weekday', dayOfWeek: 2, pairFrom: 1, pairTo: 6, weight: 0 })
      .run()
    expect(rankSubstituteCandidates(ctx.db, lessonId)).toHaveLength(0)
  })

  it('rankSubstituteCandidates помечает кандидата занятого в этот же слот другим уроком isFree=false', () => {
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId2, disciplineId: world.disciplineId, validFrom: '2026-01-01' }).run()

    const groupId2 = ctx.db
      .insert(schema.studyGroup)
      .values({ name: '12 СД', specialityId: world.specialityId, admissionYear: 2026, course: 1, studentsCount: 20, funding: 'budget', validFrom: '2026-01-01' })
      .returning({ id: schema.studyGroup.id })
      .get().id
    const loadId2 = ctx.db
      .insert(schema.teachingLoad)
      .values({ semesterId: world.semesterId, curriculumRowId: world.curriculumRowId, teacherId: world.teacherId2, groupId: groupId2, lessonKind: 'theory', hoursPlanned: 80, validFrom: '2026-01-01' })
      .returning({ id: schema.teachingLoad.id })
      .get().id

    const tmpl2 = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl2.id as number, teachingLoadId: loadId2, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: world.roomId2 })
    const plan2 = planRollout(ctx.db, { templateId: tmpl2.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-01' })
    runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, plan2, { operationId: opId }))

    const candidates = rankSubstituteCandidates(ctx.db, lessonId)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ teacherId: world.teacherId2, isFree: false })
  })

  it('applyTeacherSwap меняет преподавателя занятия и пишет substitution, конфликт занятого кандидата отклоняется', () => {
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId2, disciplineId: world.disciplineId, validFrom: '2026-01-01' }).run()

    const { operationId } = runOperation(ctx.db, 'substitution', {}, (tx, opId) =>
      applyTeacherSwap(tx, { lessonId, substituteTeacherId: world.teacherId2, reason: 'Больничный' }, { operationId: opId }),
    )

    const after = ctx.db.select().from(schema.lesson).where(eq(schema.lesson.id, lessonId)).get()!
    expect(after.teacherId).toBe(world.teacherId2)
    expect(after.status).toBe('planned')

    const sub = ctx.db.select().from(schema.substitution).where(eq(schema.substitution.lessonId, lessonId)).get()!
    expect(sub).toMatchObject({ kind: 'teacher_swap', originalTeacherId: world.teacherId, substituteTeacherId: world.teacherId2, reason: 'Больничный' })

    undoOperation(ctx.db, operationId)
    const restored = ctx.db.select().from(schema.lesson).where(eq(schema.lesson.id, lessonId)).get()!
    expect(restored.teacherId).toBe(world.teacherId)
    expect(ctx.db.select().from(schema.substitution).all()).toHaveLength(0)
  })

  it('applyTeacherSwap отклоняет кандидата, уже занятого в этот слот (конфликт §4.4)', () => {
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId2, disciplineId: world.disciplineId, validFrom: '2026-01-01' }).run()

    const groupId2 = ctx.db
      .insert(schema.studyGroup)
      .values({ name: '12 СД', specialityId: world.specialityId, admissionYear: 2026, course: 1, studentsCount: 20, funding: 'budget', validFrom: '2026-01-01' })
      .returning({ id: schema.studyGroup.id })
      .get().id
    const loadId2 = ctx.db
      .insert(schema.teachingLoad)
      .values({ semesterId: world.semesterId, curriculumRowId: world.curriculumRowId, teacherId: world.teacherId2, groupId: groupId2, lessonKind: 'theory', hoursPlanned: 80, validFrom: '2026-01-01' })
      .returning({ id: schema.teachingLoad.id })
      .get().id
    const tmpl2 = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl2.id as number, teachingLoadId: loadId2, dayOfWeek: 2, pairNo: 1, weekParity: 'all', roomId: world.roomId2 })
    const plan2 = planRollout(ctx.db, { templateId: tmpl2.id as number, dateFrom: '2026-09-01', dateTo: '2026-09-01' })
    runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, plan2, { operationId: opId }))

    expect(() => applyTeacherSwap(ctx.db, { lessonId, substituteTeacherId: world.teacherId2, reason: null }, {})).toThrow(ScheduleConflictError)
  })

  it('applyCancelLesson переводит занятие в cancelled и пишет substitution kind=cancel', () => {
    applyCancelLesson(ctx.db, { lessonId, reason: 'Праздник' }, {})
    const after = ctx.db.select().from(schema.lesson).where(eq(schema.lesson.id, lessonId)).get()!
    expect(after.status).toBe('cancelled')
    const sub = ctx.db.select().from(schema.substitution).where(eq(schema.substitution.lessonId, lessonId)).get()!
    expect(sub).toMatchObject({ kind: 'cancel', originalTeacherId: world.teacherId, reason: 'Праздник' })
  })

  it('applyMoveLesson создаёт новый lesson на новом слоте, старый помечается moved (задача этапа 7)', () => {
    const { operationId } = runOperation(ctx.db, 'substitution', {}, (tx, opId) =>
      applyMoveLesson(tx, { lessonId, newDate: '2026-09-03', newPairNo: 3, newRoomId: world.roomId2, reason: 'Перенос' }, { operationId: opId }),
    )

    const oldRow = ctx.db.select().from(schema.lesson).where(eq(schema.lesson.id, lessonId)).get()!
    expect(oldRow.status).toBe('moved')
    expect(oldRow.movedToLessonId).not.toBeNull()

    const newRow = ctx.db.select().from(schema.lesson).where(eq(schema.lesson.id, oldRow.movedToLessonId!)).get()!
    expect(newRow).toMatchObject({ date: '2026-09-03', pairNo: 3, roomId: world.roomId2, teacherId: world.teacherId, status: 'planned' })

    const newAttendees = ctx.db.select().from(schema.lessonGroup).where(eq(schema.lessonGroup.lessonId, newRow.id)).all()
    expect(newAttendees).toHaveLength(1)
    expect(newAttendees[0]!.groupId).toBe(world.groupId)

    const sub = ctx.db.select().from(schema.substitution).where(eq(schema.substitution.lessonId, lessonId)).get()!
    expect(sub).toMatchObject({ kind: 'move', reason: 'Перенос' })

    undoOperation(ctx.db, operationId)
    expect(ctx.db.select().from(schema.lesson).where(eq(schema.lesson.id, lessonId)).get()!.status).toBe('planned')
    expect(ctx.db.select().from(schema.lesson).where(eq(schema.lesson.id, newRow.id)).get()).toBeUndefined()
  })

  it('applyMoveLesson отклоняет перенос на слот, занятый другим занятием того же преподавателя', () => {
    // Второе занятие того же преподавателя в другой день — переносим первое занятие прямо туда.
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId, disciplineId: world.disciplineId, validFrom: '2026-01-01' }).run()
    const tmpl2 = createTemplate(ctx.db, { semesterId: world.semesterId, effectiveFrom: '2026-09-01', note: null })
    placeEntry(ctx.db, { templateId: tmpl2.id as number, teachingLoadId: world.teachingLoadId, dayOfWeek: 4, pairNo: 3, weekParity: 'all', roomId: world.roomId2 })
    const plan2 = planRollout(ctx.db, { templateId: tmpl2.id as number, dateFrom: '2026-09-03', dateTo: '2026-09-03' })
    runOperation(ctx.db, 'rollout', {}, (tx, opId) => applyRollout(tx, plan2, { operationId: opId }))

    expect(() =>
      runOperation(ctx.db, 'substitution', {}, (tx, opId) =>
        applyMoveLesson(tx, { lessonId, newDate: '2026-09-03', newPairNo: 3, newRoomId: null, reason: null }, { operationId: opId }),
      ),
    ).toThrow(ScheduleConflictError)
  })

  it('listTeacherSubstitutionHistory видна и отсутствующему, и заменившему (§1.1 п.29)', () => {
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId2, disciplineId: world.disciplineId, validFrom: '2026-01-01' }).run()
    applyTeacherSwap(ctx.db, { lessonId, substituteTeacherId: world.teacherId2, reason: 'Больничный' }, {})

    const original = listTeacherSubstitutionHistory(ctx.db, world.teacherId)
    expect(original).toHaveLength(1)
    expect(original[0]).toMatchObject({ role: 'original', otherTeacherName: expect.stringContaining('Петров') })

    const substitute = listTeacherSubstitutionHistory(ctx.db, world.teacherId2)
    expect(substitute).toHaveLength(1)
    expect(substitute[0]).toMatchObject({ role: 'substitute', otherTeacherName: expect.stringContaining('Иванова') })
  })

  it('listTeacherLessons не теряет занятие, отданное другому по замене, и показывает, что с ним сделано', () => {
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId2, disciplineId: world.disciplineId, validFrom: '2026-01-01' }).run()
    applyTeacherSwap(ctx.db, { lessonId, substituteTeacherId: world.teacherId2, reason: 'Больничный' }, {})

    const rows = listTeacherLessons(ctx.db, world.teacherId, '2026-09-01', '2026-09-01')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ lessonId, hasSubstitution: true, handedOver: true })
    expect(rows[0]!.substitutionNote).toContain('Петров')
    expect(rows[0]!.substitutionNote).toContain('Больничный')
  })

  it('applyTeacherSwap отклоняет преподавателя без квалификации по дисциплине (§4.3)', () => {
    expect(() => applyTeacherSwap(ctx.db, { lessonId, substituteTeacherId: world.teacherId2, reason: null }, {})).toThrow(
      SubstitutionValidationError,
    )
  })

  it('applyMoveLesson допускает перенос в тот же слот со сменой кабинета (частичный уникальный индекс §4.4)', () => {
    runOperation(ctx.db, 'substitution', {}, (tx, opId) =>
      applyMoveLesson(tx, { lessonId, newDate: '2026-09-01', newPairNo: 1, newRoomId: world.roomId2, reason: 'Кабинет занят' }, { operationId: opId }),
    )

    const oldRow = ctx.db.select().from(schema.lesson).where(eq(schema.lesson.id, lessonId)).get()!
    expect(oldRow.status).toBe('moved')
    const newRow = ctx.db.select().from(schema.lesson).where(eq(schema.lesson.id, oldRow.movedToLessonId!)).get()!
    expect(newRow).toMatchObject({ date: '2026-09-01', pairNo: 1, roomId: world.roomId2, status: 'planned' })
  })

  it('applyTeacherSwap кидает NotFoundError на несуществующее занятие', () => {
    expect(() => applyTeacherSwap(ctx.db, { lessonId: 999999, substituteTeacherId: world.teacherId2, reason: null }, {})).toThrow(NotFoundError)
  })
})
