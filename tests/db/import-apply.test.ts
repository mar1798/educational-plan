import { eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyCalendarPeriodRows, applyCurriculumRows, applyTeacherRows, applyTeachingLoadRows } from '../../src/main/import/apply'
import * as schema from '../../src/main/db/schema'
import { createTestDb, seedMinimalWorld, type MinimalWorld } from './helpers'
import { ensureTeacherCategories } from '../../src/main/db/repo/seed'

describe('применение размеченных строк импорта к таблицам (§3.8, §3.8e)', () => {
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

  it('создаёт преподавателей и пропускает строки без имени или с неизвестной категорией', () => {
    const result = applyTeacherRows(ctx.db, [
      { lastName: 'Сидорова', firstName: 'А', categoryCode: 'staff' },
      { lastName: '', firstName: 'Б' },
      { lastName: 'Кузнецов', firstName: 'В', categoryCode: 'unknown' },
    ])
    expect(result.created).toBe(1)
    expect(result.skipped).toHaveLength(2)
    const created = ctx.db.select().from(schema.teacher).where(eq(schema.teacher.lastName, 'Сидорова')).get()
    expect(created?.firstName).toBe('А')
  })

  it('создаёт периоды календаря и пропускает неизвестные типы', () => {
    const result = applyCalendarPeriodRows(ctx.db, [
      { kind: 'practice', course: 2, startsOn: '2026-10-01', endsOn: '2026-10-14' },
      { kind: 'unknown_kind', startsOn: '2026-11-01', endsOn: '2026-11-05' },
    ])
    expect(result.created).toBe(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.reason).toContain('неизвестный тип')
  })

  it('создаёт строку плана при найденной дисциплине и пропускает при ненайденной', () => {
    const otherCurriculumId = ctx.db
      .insert(schema.curriculum)
      .values({ specialityId: world.specialityId, admissionYear: 2030, name: 'Другой план' })
      .returning({ id: schema.curriculum.id })
      .get().id

    const result = applyCurriculumRows(
      ctx.db,
      otherCurriculumId,
      [
        { disciplineName: 'анатомия', course: 1, semesterNo: 1, credits: 4, hoursTotal: 120, hoursClassroom: 80 },
        { disciplineName: 'Несуществующая дисциплина', course: 1, semesterNo: 1, credits: 2, hoursTotal: 60, hoursClassroom: 40 },
      ],
      '2026-01-01',
    )
    expect(result.created).toBe(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.reason).toContain('не найдена в справочнике')

    const rows = ctx.db.select().from(schema.curriculumRow).where(eq(schema.curriculumRow.curriculumId, otherCurriculumId)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.disciplineId).toBe(world.disciplineId)
  })

  it('резолвит нагрузку через план группы и создаёт строку при наличии квалификации', () => {
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId, disciplineId: world.disciplineId, validFrom: '2020-01-01' }).run()
    // Освобождаем недельный лимит от строки, заведённой seedMinimalWorld для того же курса/семестра.
    ctx.db.delete(schema.teachingLoad).where(eq(schema.teachingLoad.id, world.teachingLoadId)).run()

    const result = applyTeachingLoadRows(
      ctx.db,
      world.semesterId,
      [
        { teacherName: 'Иванова Т', groupName: '11 СД', disciplineName: 'Анатомия', lessonKind: 'theory', hoursPlanned: 10 },
        { teacherName: 'Неизвестный Н', groupName: '11 СД', disciplineName: 'Анатомия', lessonKind: 'theory', hoursPlanned: 5 },
      ],
      '2026-09-01',
    )
    expect(result.created).toBe(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.reason).toContain('не найден')

    const rows = ctx.db.select().from(schema.teachingLoad).where(eq(schema.teachingLoad.teacherId, world.teacherId)).all()
    expect(rows.some((r) => r.hoursPlanned === 10)).toBe(true)
  })

  it('пропускает нагрузку без действующей квалификации преподавателя, не роняя весь импорт', () => {
    ctx.db.delete(schema.teachingLoad).where(eq(schema.teachingLoad.id, world.teachingLoadId)).run()

    const result = applyTeachingLoadRows(
      ctx.db,
      world.semesterId,
      [{ teacherName: 'Иванова Т', groupName: '11 СД', disciplineName: 'Анатомия', lessonKind: 'theory', hoursPlanned: 10 }],
      '2026-09-01',
    )
    expect(result.created).toBe(0)
    expect(result.skipped[0]!.reason).toContain('квалификации')
  })
  it('принимает категорию преподавателя по-русски — названием справочника и обиходным синонимом', () => {
    ensureTeacherCategories(ctx.db) // в минимальном мире заведена только штатная категория
    const result = applyTeacherRows(ctx.db, [
      { lastName: 'Назарова', firstName: 'Махабат', categoryCode: 'Почасовик' },
      { lastName: 'Дикамбаев', firstName: 'Марат', categoryCode: 'внештат' },
      { lastName: 'Абдиева', firstName: 'Жыпар', categoryCode: 'Штатный' },
    ])
    expect(result.created).toBe(3)
    expect(result.skipped).toHaveLength(0)

    const categories = new Map(ctx.db.select().from(schema.teacherCategory).all().map((c) => [c.id, c.code]))
    const byName = (lastName: string) => {
      const t = ctx.db.select().from(schema.teacher).where(eq(schema.teacher.lastName, lastName)).get()
      return categories.get(t!.categoryId)
    }
    expect(byName('Назарова')).toBe('hourly')
    expect(byName('Дикамбаев')).toBe('external')
    expect(byName('Абдиева')).toBe('staff')
  })

  it('не заводит второй раз того же преподавателя при повторном импорте файла', () => {
    ensureTeacherCategories(ctx.db)
    const rows = [{ lastName: 'Назарова', firstName: 'Махабат', middleName: 'Женишбековна', categoryCode: 'Почасовик' }]
    expect(applyTeacherRows(ctx.db, rows).created).toBe(1)

    const again = applyTeacherRows(ctx.db, rows)
    expect(again.created).toBe(0)
    expect(again.skipped[0]!.reason).toContain('уже есть')
    expect(ctx.db.select().from(schema.teacher).where(eq(schema.teacher.lastName, 'Назарова')).all()).toHaveLength(1)
  })

  it('принимает период календаря по-русски и дату в виде ДД.ММ.ГГГГ', () => {
    const result = applyCalendarPeriodRows(ctx.db, [
      { kind: 'Зимние каникулы', startsOn: '16.01.2027', endsOn: '08.02.2027' },
      { kind: 'Производственная практика', course: 2, startsOn: '2026-10-01', endsOn: '2026-10-14' },
    ])
    expect(result.created).toBe(2)

    const vacation = ctx.db.select().from(schema.calendarPeriod).where(eq(schema.calendarPeriod.kind, 'vacation')).get()
    expect(vacation?.startsOn).toBe('2027-01-16')
    expect(vacation?.endsOn).toBe('2027-02-08')
  })

  it('отбивает период с нераспознанной датой и с окончанием раньше начала', () => {
    const result = applyCalendarPeriodRows(ctx.db, [
      { kind: 'Каникулы', startsOn: 'январь', endsOn: '2027-02-08' },
      { kind: 'Каникулы', startsOn: '2027-02-08', endsOn: '2027-01-16' },
    ])
    expect(result.created).toBe(0)
    expect(result.skipped[0]!.reason).toContain('не распознана')
    expect(result.skipped[1]!.reason).toContain('раньше даты начала')
  })

  it('принимает вид занятия по-русски и ФИО с отчеством, не задваивая строку при повторе', () => {
    ctx.db.insert(schema.teacherQualification).values({ teacherId: world.teacherId, disciplineId: world.disciplineId, validFrom: '2020-01-01' }).run()
    ctx.db.delete(schema.teachingLoad).where(eq(schema.teachingLoad.id, world.teachingLoadId)).run()

    const rows = [{ teacherName: 'Иванова Т Петровна', groupName: '11 СД', disciplineName: 'Анатомия', lessonKind: 'Семинарское', hoursPlanned: 10 }]
    const first = applyTeachingLoadRows(ctx.db, world.semesterId, rows, '2026-09-01')
    expect(first.created).toBe(1)
    expect(ctx.db.select().from(schema.teachingLoad).all().some((r) => r.lessonKind === 'seminar')).toBe(true)

    const again = applyTeachingLoadRows(ctx.db, world.semesterId, rows, '2026-09-01')
    expect(again.created).toBe(0)
    expect(again.skipped[0]!.reason).toContain('уже есть')
  })

  it('не заводит вторую строку плана с той же дисциплиной, курсом и семестром', () => {
    const otherCurriculumId = ctx.db
      .insert(schema.curriculum)
      .values({ specialityId: world.specialityId, admissionYear: 2031, name: 'План для повтора' })
      .returning({ id: schema.curriculum.id })
      .get().id
    const rows = [{ disciplineName: 'Анатомия', course: 1, semesterNo: 1, credits: 4, hoursTotal: 120, hoursClassroom: 80 }]

    expect(applyCurriculumRows(ctx.db, otherCurriculumId, rows, '2026-01-01').created).toBe(1)
    const again = applyCurriculumRows(ctx.db, otherCurriculumId, rows, '2026-01-01')
    expect(again.created).toBe(0)
    expect(again.skipped[0]!.reason).toContain('уже есть')
  })
})
