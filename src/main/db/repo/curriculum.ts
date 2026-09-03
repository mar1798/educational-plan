import { and, asc, eq, gte, inArray, isNull } from 'drizzle-orm'
import { curriculum, curriculumRow, curriculumWeek } from '../schema/curriculum'
import { lesson } from '../schema/schedule'
import { teachingLoad } from '../schema/load'
import type { AuditContext } from './audit'
import { closeRow, createRow, NotFoundError, updateRow } from './base-repo'
import type { DbLike } from './types'

/**
 * Равномерное распределение часов по неделям (§3.4) — тот же приём, что при делении
 * группы на подгруппы (division-scheme.ts:computeEvenSplit): база + остаток первым неделям.
 */
export function computeEvenWeeklyHours(hoursClassroom: number, weekCount: number): { weekNo: number; hours: number }[] {
  const base = Math.floor(hoursClassroom / weekCount)
  const remainder = hoursClassroom % weekCount
  const weeks: { weekNo: number; hours: number }[] = []
  for (let weekNo = 1; weekNo <= weekCount; weekNo++) {
    weeks.push({ weekNo, hours: base + (weekNo <= remainder ? 1 : 0) })
  }
  return weeks
}

/**
 * Сколько занятий уже проведено/запланировано по строке плана начиная с даты (§3.2:
 * «затронуто занятий: N после 12.10») — считается через teaching_load, т.к. lesson
 * не хранит curriculum_row_id напрямую.
 */
export function countAffectedLessons(tx: DbLike, curriculumRowId: number, afterDate: string): number {
  const rows = tx
    .select({ id: lesson.id })
    .from(lesson)
    .innerJoin(teachingLoad, eq(lesson.teachingLoadId, teachingLoad.id))
    .where(
      and(
        eq(teachingLoad.curriculumRowId, curriculumRowId),
        gte(lesson.date, afterDate),
        inArray(lesson.status, ['planned', 'held']),
      ),
    )
    .all()
  return rows.length
}

export interface CurriculumRowInput {
  disciplineId: number
  course: number
  semesterNo: number
  credits: number
  hoursTotal: number
  hoursClassroom: number
  hoursTheory: number
  hoursPractice: number
  hoursSeminar: number
  hoursLab: number
  hoursSrs: number
  controlSemester: number | null
}

/**
 * Создание строки плана — обычный createRow, версионирование тут не нужно: у строки
 * ещё нет предыдущей версии.
 */
export function createCurriculumRow(tx: DbLike, curriculumId: number, input: CurriculumRowInput, validFrom: string, ctx: AuditContext = {}) {
  return createRow(tx, curriculumRow, { curriculumId, ...input, validFrom }, ctx)
}

/**
 * Правка строки плана (§3.2). У черновика (`curriculum.status = 'draft'`) правка ещё
 * не «утверждена» — обычный updateRow. У утверждённого плана правка создаёт новую
 * версию: старая строка закрывается (`validTo`), новая получает `supersedesId`.
 * Так «затронуто занятий после даты» становится буквальным: занятия после validTo
 * старой строки продолжают ссылаться на неё же (teaching_load не переезжает
 * автоматически) — это намеренно предупреждение, а не автоматическая миграция:
 * завуч должен явно решить, что делать с уже расставленной нагрузкой.
 */
export function editCurriculumRow(
  tx: DbLike,
  rowId: number,
  patch: Partial<CurriculumRowInput>,
  expectedRowVersion: number,
  effectiveFrom: string,
  ctx: AuditContext = {},
): { row: Record<string, unknown>; versioned: boolean } {
  const row = tx.select().from(curriculumRow).where(eq(curriculumRow.id, rowId)).get()
  if (!row) throw new NotFoundError('curriculum_row', rowId)
  const plan = tx.select().from(curriculum).where(eq(curriculum.id, row.curriculumId)).get()
  if (!plan) throw new NotFoundError('curriculum', row.curriculumId)

  if (plan.status !== 'approved') {
    const updated = updateRow(tx, curriculumRow, rowId, patch, expectedRowVersion, ctx)
    return { row: updated, versioned: false }
  }

  closeRow(tx, curriculumRow, rowId, effectiveFrom, expectedRowVersion, ctx)
  const { curriculumId, disciplineId, course, semesterNo, credits, hoursTotal, hoursClassroom, hoursTheory, hoursPractice, hoursSeminar, hoursLab, hoursSrs, controlSemester } = row as unknown as CurriculumRowInput & { curriculumId: number }
  const created = createRow(
    tx,
    curriculumRow,
    {
      curriculumId,
      disciplineId,
      course,
      semesterNo,
      credits,
      hoursTotal,
      hoursClassroom,
      hoursTheory,
      hoursPractice,
      hoursSeminar,
      hoursLab,
      hoursSrs,
      controlSemester,
      validFrom: effectiveFrom,
      supersedesId: rowId,
      ...patch,
    },
    ctx,
  )
  return { row: created, versioned: true }
}

/**
 * Копирование плана на новый набор (§3.3): переносит все строки утверждённого/чернового
 * плана в новый черновик. Недельная раскладка не копируется — она per-семестр и
 * зависит от календаря конкретного семестра, создаётся заново (3.4). Специальность
 * копии не обязана совпадать с исходным планом (§3.10: «шаблоны специальностей» —
 * план одной специальности можно использовать как заготовку для другой).
 */
export function copyCurriculum(
  tx: DbLike,
  fromCurriculumId: number,
  target: { specialityId: number; admissionYear: number; name: string },
  ctx: AuditContext = {},
) {
  const source = tx.select().from(curriculum).where(eq(curriculum.id, fromCurriculumId)).get()
  if (!source) throw new NotFoundError('curriculum', fromCurriculumId)

  const newPlan = createRow(
    tx,
    curriculum,
    { specialityId: target.specialityId, admissionYear: target.admissionYear, name: target.name, status: 'draft' as const },
    ctx,
  )

  const sourceRows = tx
    .select()
    .from(curriculumRow)
    .where(and(eq(curriculumRow.curriculumId, fromCurriculumId), isNull(curriculumRow.validTo)))
    .all()

  for (const r of sourceRows) {
    createRow(
      tx,
      curriculumRow,
      {
        curriculumId: newPlan.id as number,
        disciplineId: r.disciplineId,
        course: r.course,
        semesterNo: r.semesterNo,
        credits: r.credits,
        hoursTotal: r.hoursTotal,
        hoursClassroom: r.hoursClassroom,
        hoursTheory: r.hoursTheory,
        hoursPractice: r.hoursPractice,
        hoursSeminar: r.hoursSeminar,
        hoursLab: r.hoursLab,
        hoursSrs: r.hoursSrs,
        controlSemester: r.controlSemester,
        validFrom: r.validFrom,
      },
      ctx,
    )
  }

  return newPlan
}

export interface CurriculumWeekRow {
  id: number
  curriculumRowId: number
  weekNo: number
  hours: number
  rowVersion: number
}

export function listCurriculumWeeks(tx: DbLike, curriculumRowId: number): CurriculumWeekRow[] {
  return tx
    .select()
    .from(curriculumWeek)
    .where(eq(curriculumWeek.curriculumRowId, curriculumRowId))
    .orderBy(asc(curriculumWeek.weekNo))
    .all() as unknown as CurriculumWeekRow[]
}

/**
 * Генерация недельной раскладки (§3.4): равномерно по умолчанию, перезаписывает
 * прежнюю раскладку той же строки целиком (она пересоздаётся, а не правится построчно —
 * смена числа недель делает старые номера недель бессмысленными).
 */
export function generateCurriculumWeeks(tx: DbLike, curriculumRowId: number, weekCount: number, ctx: AuditContext = {}): CurriculumWeekRow[] {
  const row = tx.select().from(curriculumRow).where(eq(curriculumRow.id, curriculumRowId)).get()
  if (!row) throw new NotFoundError('curriculum_row', curriculumRowId)

  const existing = tx.select().from(curriculumWeek).where(eq(curriculumWeek.curriculumRowId, curriculumRowId)).all()
  for (const w of existing) {
    tx.delete(curriculumWeek).where(eq(curriculumWeek.id, w.id)).run()
  }

  const weeks = computeEvenWeeklyHours(row.hoursClassroom, weekCount)
  for (const w of weeks) {
    createRow(tx, curriculumWeek, { curriculumRowId, weekNo: w.weekNo, hours: w.hours }, ctx)
  }
  return listCurriculumWeeks(tx, curriculumRowId)
}

/** Правка недельной раскладки вручную (§3.4) — построчно, с построчным rowVersion. */
export function updateCurriculumWeeks(
  tx: DbLike,
  curriculumRowId: number,
  weeks: { id: number; rowVersion: number; hours: number }[],
  ctx: AuditContext = {},
): CurriculumWeekRow[] {
  const existing = tx.select().from(curriculumWeek).where(eq(curriculumWeek.curriculumRowId, curriculumRowId)).all()
  if (weeks.length !== existing.length) throw new Error('Число недель в правке не совпадает с раскладкой')
  const existingIds = new Set(existing.map((w) => w.id))
  for (const w of weeks) {
    if (!existingIds.has(w.id)) throw new Error(`Неделя #${w.id} не относится к строке плана #${curriculumRowId}`)
    updateRow(tx, curriculumWeek, w.id, { hours: w.hours }, w.rowVersion, ctx)
  }
  return listCurriculumWeeks(tx, curriculumRowId)
}
