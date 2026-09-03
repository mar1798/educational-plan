/**
 * Мастер замены (§1.1 п.22, п.29, этап 7 PLAN.md): подбор преподавателя вместо
 * отсутствующего, отмена или перенос занятия — все три действия работают над уже
 * материализованными `lesson` (не над `template_entry`, это отдельный уровень §4.8),
 * пишут строку в `substitution` и обёрнуты вызывающей стороной в
 * `runOperation(db, 'substitution', ...)`, поэтому автоматически отменяемы (§1.5).
 */
import { and, eq, inArray, ne } from 'drizzle-orm'
import { describeConflicts } from '../../../shared/schedule/messages'
import { findConflicts, type SlotEntry } from '../../../solver/validate'
import type { AuditContext } from './audit'
import { createRow, NotFoundError, updateRow } from './base-repo'
import { lessonLabel, nameResolver, ScheduleConflictError, studyGroupById } from './schedule-template'
import { isTeacherQualified, normHoursYearOf, totalTeacherHours } from './teaching-load'
import type { DbLike } from './types'
import { discipline } from '../schema/curriculum'
import { room } from '../schema/org'
import { lesson, lessonGroup, substitution } from '../schema/schedule'
import { subgroup, teacher, teacherAbsence, teacherCategory } from '../schema/people'

function dayOfWeekOf(date: string): number {
  // ISO getUTCDay(): 0=вс..6=сб; в проекте недели 1..6 = пн..сб (§2, WEEKDAY_LABEL) —
  // тот же пересчёт, что и в schedule-template.ts.
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

function teacherFullName(t: { lastName: string; firstName: string; middleName: string | null }): string {
  const initials = [t.firstName, t.middleName].filter(Boolean).map((n) => `${(n as string)[0]}.`).join('')
  return `${t.lastName} ${initials}`
}

/** Замена не проходит по предметным правилам (квалификация) — не конфликт слота, а отказ мастера. */
export class SubstitutionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubstitutionValidationError'
  }
}

export interface TeacherLessonRow {
  lessonId: number
  date: string
  pairNo: number
  disciplineName: string
  targetLabel: string
  roomLabel: string | null
  status: 'planned' | 'held' | 'cancelled' | 'moved'
  academicHours: number
  hasSubstitution: boolean
  /** Что уже сделано с этим занятием — история замен на карточке занятия (§этап 7, п.29). */
  substitutionNote: string | null
  /** Занятие уже передано другому преподавателю: этот его больше не ведёт, действовать по нему нечего. */
  handedOver: boolean
  /** Кто ведёт занятие сейчас — у переданного по замене это уже заместивший преподаватель. */
  currentTeacherId: number
  currentTeacherName: string
}

/** Короткая подпись строки `substitution` для карточки занятия (§этап 7, п.29). */
function substitutionNoteOf(tx: DbLike, s: typeof substitution.$inferSelect): string {
  const withReason = (text: string): string => (s.reason ? `${text} (${s.reason})` : text)
  if (s.kind === 'cancel') return withReason('Занятие отменено')
  if (s.kind === 'move') return withReason('Занятие перенесено')
  if (s.kind === 'room_swap') return withReason('Заменён кабинет')
  const sub = s.substituteTeacherId != null ? tx.select().from(teacher).where(eq(teacher.id, s.substituteTeacherId)).get() : null
  return withReason(sub ? `Заменяет ${teacherFullName(sub)}` : 'Замена преподавателя')
}

/**
 * Занятия преподавателя в диапазоне дат (шаг 2 мастера) — вся история статусов, не только
 * «planned». Занятие, уже переданное другому по замене, из списка не исчезает: оно больше
 * не числится за этим преподавателем (`lesson.teacher_id` сменился), но завуч должен видеть,
 * что оно обработано, — поэтому берутся и занятия, где он `original_teacher_id` в `substitution`.
 */
export function listTeacherLessons(tx: DbLike, teacherId: number, dateFrom: string, dateTo: string): TeacherLessonRow[] {
  const handedOverIds = tx
    .select({ lessonId: substitution.lessonId })
    .from(substitution)
    .where(eq(substitution.originalTeacherId, teacherId))
    .all()
    .map((r) => r.lessonId)

  const own = tx.select().from(lesson).where(eq(lesson.teacherId, teacherId)).all()
  const byId = new Map(own.map((l) => [l.id, l]))
  for (const id of handedOverIds) {
    if (byId.has(id)) continue
    const l = tx.select().from(lesson).where(eq(lesson.id, id)).get()
    if (l) byId.set(l.id, l)
  }

  const rows = [...byId.values()]
    .filter((l) => l.date >= dateFrom && l.date <= dateTo)
    .sort((a, b) => (a.date === b.date ? a.pairNo - b.pairNo : a.date < b.date ? -1 : 1))

  return rows.map((l) => {
    const disc = tx.select().from(discipline).where(eq(discipline.id, l.disciplineId)).get()
    const attendees = tx.select().from(lessonGroup).where(eq(lessonGroup.lessonId, l.id)).all()
    const targetLabel = attendees
      .map((a) => {
        const g = studyGroupById(tx, a.groupId)
        const sg = a.subgroupId != null ? tx.select().from(subgroup).where(eq(subgroup.id, a.subgroupId)).get() : null
        return sg ? `${g?.name ?? `#${a.groupId}`} п/гр ${sg.no}` : (g?.name ?? `#${a.groupId}`)
      })
      .join(', ')
    const roomLabel = l.roomId != null ? (roomLabelOf(tx, l.roomId) ?? null) : null
    const currentTeacher = tx.select().from(teacher).where(eq(teacher.id, l.teacherId)).get()
    const subs = tx.select().from(substitution).where(eq(substitution.lessonId, l.id)).all()
    const last = subs.at(-1)

    return {
      lessonId: l.id,
      date: l.date,
      pairNo: l.pairNo,
      disciplineName: disc?.name ?? '—',
      targetLabel,
      roomLabel,
      status: l.status,
      academicHours: l.academicHours,
      hasSubstitution: last != null,
      substitutionNote: last != null ? substitutionNoteOf(tx, last) : null,
      handedOver: l.teacherId !== teacherId,
      currentTeacherId: l.teacherId,
      currentTeacherName: currentTeacher ? teacherFullName(currentTeacher) : `#${l.teacherId}`,
    }
  })
}

function roomLabelOf(tx: DbLike, roomId: number): string | undefined {
  return tx.select({ number: room.number }).from(room).where(eq(room.id, roomId)).get()?.number
}

export interface SubstituteCandidate {
  teacherId: number
  teacherName: string
  categoryTitle: string
  isFree: boolean
  assignedHoursYear: number
  normHoursYear: number | null
  shortfallHours: number | null
}

/**
 * Кандидаты на замену (§этап 7): квалификация — жёсткий фильтр (как и hard-недоступность,
 * исключаются полностью, а не просто помечаются — так же, как солвер их не рассматривает),
 * дальше ранжирование «свободен → недобор часов» (задача этапа 7).
 */
export function rankSubstituteCandidates(tx: DbLike, lessonId: number): SubstituteCandidate[] {
  const l = tx.select().from(lesson).where(eq(lesson.id, lessonId)).get()
  if (!l) throw new NotFoundError('lesson', lessonId)

  const weekday = dayOfWeekOf(l.date)
  const busyTeacherIds = new Set(
    tx
      .select({ teacherId: lesson.teacherId })
      .from(lesson)
      .where(and(eq(lesson.date, l.date), eq(lesson.pairNo, l.pairNo), inArray(lesson.status, ['planned', 'held']), ne(lesson.id, lessonId)))
      .all()
      .map((r) => r.teacherId),
  )

  const candidates = tx
    .select()
    .from(teacher)
    .where(ne(teacher.id, l.teacherId))
    .all()
    .filter((t) => (t.firedAt == null || t.firedAt > l.date) && (t.hiredAt == null || t.hiredAt <= l.date))
    .filter((t) => isTeacherQualified(tx, t.id, l.disciplineId, l.date))
    .filter((t) => !hasHardAbsence(tx, t.id, l.date, weekday, l.pairNo))

  const result: SubstituteCandidate[] = candidates.map((t) => {
    const category = tx.select().from(teacherCategory).where(eq(teacherCategory.id, t.categoryId)).get()
    const normHoursYear = normHoursYearOf(category, t.rate)
    const assignedHoursYear = totalTeacherHours(tx, t.id)
    return {
      teacherId: t.id,
      teacherName: teacherFullName(t),
      categoryTitle: category?.titleRu ?? '—',
      isFree: !busyTeacherIds.has(t.id),
      assignedHoursYear,
      normHoursYear,
      shortfallHours: normHoursYear != null ? normHoursYear - assignedHoursYear : null,
    }
  })

  result.sort((a, b) => {
    if (a.isFree !== b.isFree) return a.isFree ? -1 : 1
    const sa = a.shortfallHours ?? Number.NEGATIVE_INFINITY
    const sb = b.shortfallHours ?? Number.NEGATIVE_INFINITY
    if (sa !== sb) return sb - sa
    if (a.assignedHoursYear !== b.assignedHoursYear) return a.assignedHoursYear - b.assignedHoursYear
    return a.teacherName.localeCompare(b.teacherName, 'ru')
  })

  return result
}

function hasHardAbsence(tx: DbLike, teacherId: number, date: string, weekday: number, pairNo: number): boolean {
  const rows = tx.select().from(teacherAbsence).where(and(eq(teacherAbsence.teacherId, teacherId), eq(teacherAbsence.kind, 'hard'))).all()
  return rows.some((a) => {
    if (pairNo < a.pairFrom || pairNo > a.pairTo) return false
    if (a.scope === 'weekday') return a.dayOfWeek === weekday
    return a.dateFrom != null && a.dateTo != null && date >= a.dateFrom && date <= a.dateTo
  })
}

/** SlotEntry-представление одного lesson — тот же приём, что в `listLessonConflicts` (dayOfWeek=0 — сравнение только внутри уже отобранной даты+пары). */
function lessonToSlotEntry(tx: DbLike, l: { id: number; pairNo: number; teacherId: number; roomId: number | null }): SlotEntry {
  const attendees = tx
    .select()
    .from(lessonGroup)
    .where(eq(lessonGroup.lessonId, l.id))
    .all()
    .map((a) => ({ groupId: a.groupId, posFrom: a.posFrom, posTo: a.posTo }))
  return { id: l.id, dayOfWeek: 0, pairNo: l.pairNo, weekParity: 'all', teacherId: l.teacherId, roomId: l.roomId, attendees }
}

function otherLessonsAt(tx: DbLike, date: string, pairNo: number, excludeLessonId: number) {
  return tx
    .select()
    .from(lesson)
    .where(and(eq(lesson.date, date), eq(lesson.pairNo, pairNo), inArray(lesson.status, ['planned', 'held']), ne(lesson.id, excludeLessonId)))
    .all()
}

function assertNoConflict(tx: DbLike, candidate: SlotEntry, others: ReturnType<typeof otherLessonsAt>, message: string): void {
  const otherEntries = others.map((o) => lessonToSlotEntry(tx, o))
  const conflicts = findConflicts(candidate, otherEntries)
  if (conflicts.length === 0) return
  const entryLabels = new Map(others.map((o) => [o.id, lessonLabel(tx, o)]))
  throw new ScheduleConflictError(conflicts, `${message}: ${describeConflicts(conflicts, nameResolver(tx, entryLabels))}`)
}

export interface ApplySubstitutionInput {
  lessonId: number
  reason: string | null
}

/** Замена преподавателя (kind='teacher_swap', §этап 7): кабинет и состав группы не меняются. */
export function applyTeacherSwap(
  tx: DbLike,
  input: ApplySubstitutionInput & { substituteTeacherId: number },
  ctx: AuditContext = {},
): { lesson: Record<string, unknown>; substitutionId: number } {
  const before = tx.select().from(lesson).where(eq(lesson.id, input.lessonId)).get()
  if (!before) throw new NotFoundError('lesson', input.lessonId)
  const sub = tx.select().from(teacher).where(eq(teacher.id, input.substituteTeacherId)).get()
  if (!sub) throw new NotFoundError('teacher', input.substituteTeacherId)
  // Тот же жёсткий фильтр, что и в rankSubstituteCandidates и в saveTeachingLoad (§4.3):
  // мастер таких кандидатов не показывает, но IPC-вход проверяется отдельно.
  if (!isTeacherQualified(tx, sub.id, before.disciplineId, before.date)) {
    throw new SubstitutionValidationError(
      `Преподаватель ${sub.lastName} ${sub.firstName} не имеет действующей квалификации по этой дисциплине на ${before.date}`,
    )
  }

  const candidate = lessonToSlotEntry(tx, { id: before.id, pairNo: before.pairNo, teacherId: input.substituteTeacherId, roomId: before.roomId })
  assertNoConflict(tx, candidate, otherLessonsAt(tx, before.date, before.pairNo, before.id), 'Замена невозможна')

  const updated = updateRow(tx, lesson, before.id, { teacherId: input.substituteTeacherId }, before.rowVersion, ctx)
  const createdSub = createRow(
    tx,
    substitution,
    {
      lessonId: before.id,
      kind: 'teacher_swap' as const,
      originalTeacherId: before.teacherId,
      substituteTeacherId: input.substituteTeacherId,
      originalRoomId: before.roomId,
      newRoomId: null,
      reason: input.reason,
      createdBy: ctx.user ?? 'admin',
    },
    ctx,
  )
  return { lesson: updated, substitutionId: createdSub.id as number }
}

/** Отмена занятия (kind='cancel', §этап 7): часы не переносятся никуда, попадают в «вычтенные». */
export function applyCancelLesson(tx: DbLike, input: ApplySubstitutionInput, ctx: AuditContext = {}): { lesson: Record<string, unknown>; substitutionId: number } {
  const before = tx.select().from(lesson).where(eq(lesson.id, input.lessonId)).get()
  if (!before) throw new NotFoundError('lesson', input.lessonId)

  const updated = updateRow(tx, lesson, before.id, { status: 'cancelled' as const }, before.rowVersion, ctx)
  const createdSub = createRow(
    tx,
    substitution,
    {
      lessonId: before.id,
      kind: 'cancel' as const,
      originalTeacherId: before.teacherId,
      substituteTeacherId: null,
      originalRoomId: before.roomId,
      newRoomId: null,
      reason: input.reason,
      createdBy: ctx.user ?? 'admin',
    },
    ctx,
  )
  return { lesson: updated, substitutionId: createdSub.id as number }
}

export interface MoveLessonInput extends ApplySubstitutionInput {
  newDate: string
  newPairNo: number
  newRoomId: number | null
}

/** Перенос занятия (kind='move', §этап 7): создаёт новый lesson на новом слоте, старый помечается status='moved'. */
export function applyMoveLesson(
  tx: DbLike,
  input: MoveLessonInput,
  ctx: AuditContext & { operationId: number },
): { oldLesson: Record<string, unknown>; newLesson: Record<string, unknown>; substitutionId: number } {
  const before = tx.select().from(lesson).where(eq(lesson.id, input.lessonId)).get()
  if (!before) throw new NotFoundError('lesson', input.lessonId)

  const newRoomId = input.newRoomId ?? before.roomId
  const candidate = lessonToSlotEntry(tx, { id: -1, pairNo: input.newPairNo, teacherId: before.teacherId, roomId: newRoomId })
  const attendees = tx.select().from(lessonGroup).where(eq(lessonGroup.lessonId, before.id)).all()
  candidate.attendees = attendees.map((a) => ({ groupId: a.groupId, posFrom: a.posFrom, posTo: a.posTo }))
  assertNoConflict(tx, candidate, otherLessonsAt(tx, input.newDate, input.newPairNo, before.id), 'Перенос невозможен')

  // Старое занятие снимается со слота ДО вставки нового: иначе перенос «в тот же слот»
  // (например, только смена кабинета) упирается в частичный уникальный индекс
  // uq_lesson_teacher по (teacher_id, date, pair_no) для статусов planned/held (§4.4).
  const movedOld = updateRow(tx, lesson, before.id, { status: 'moved' as const }, before.rowVersion, ctx)

  const newLessonRow = createRow(
    tx,
    lesson,
    {
      date: input.newDate,
      pairNo: input.newPairNo,
      teachingLoadId: before.teachingLoadId,
      teacherId: before.teacherId,
      roomId: newRoomId,
      disciplineId: before.disciplineId,
      lessonKind: before.lessonKind,
      academicHours: before.academicHours,
      templateEntryId: before.templateEntryId,
      templateId: before.templateId,
      status: 'planned' as const,
      operationId: ctx.operationId,
      note: before.note,
    },
    ctx,
  )
  for (const a of attendees) {
    createRow(tx, lessonGroup, { lessonId: newLessonRow.id as number, groupId: a.groupId, subgroupId: a.subgroupId, posFrom: a.posFrom, posTo: a.posTo }, ctx)
  }

  const updatedOld = updateRow(tx, lesson, before.id, { movedToLessonId: newLessonRow.id as number }, movedOld.rowVersion as number, ctx)
  const createdSub = createRow(
    tx,
    substitution,
    {
      lessonId: before.id,
      kind: 'move' as const,
      originalTeacherId: before.teacherId,
      substituteTeacherId: null,
      originalRoomId: before.roomId,
      newRoomId: input.newRoomId != null ? input.newRoomId : null,
      reason: input.reason,
      createdBy: ctx.user ?? 'admin',
    },
    ctx,
  )
  return { oldLesson: updatedOld, newLesson: newLessonRow, substitutionId: createdSub.id as number }
}

export interface SubstitutionHistoryRow {
  id: number
  lessonId: number
  date: string
  pairNo: number
  disciplineName: string
  kind: 'teacher_swap' | 'room_swap' | 'cancel' | 'move'
  role: 'original' | 'substitute'
  otherTeacherName: string | null
  reason: string | null
  createdAt: string
}

/** История замен на карточке преподавателя (§этап 7, п.29) — и как отсутствующий, и как замена. */
export function listTeacherSubstitutionHistory(tx: DbLike, teacherId: number): SubstitutionHistoryRow[] {
  const rows = tx.select().from(substitution).all().filter((s) => s.originalTeacherId === teacherId || s.substituteTeacherId === teacherId)

  return rows
    .map((s) => {
      const l = tx.select().from(lesson).where(eq(lesson.id, s.lessonId)).get()
      const disc = l ? tx.select().from(discipline).where(eq(discipline.id, l.disciplineId)).get() : null
      const role: 'original' | 'substitute' = s.originalTeacherId === teacherId ? 'original' : 'substitute'
      const otherTeacherId = role === 'original' ? s.substituteTeacherId : s.originalTeacherId
      const otherTeacher = otherTeacherId != null ? tx.select().from(teacher).where(eq(teacher.id, otherTeacherId)).get() : null
      return {
        id: s.id,
        lessonId: s.lessonId,
        date: l?.date ?? '—',
        pairNo: l?.pairNo ?? 0,
        disciplineName: disc?.name ?? '—',
        kind: s.kind,
        role,
        otherTeacherName: otherTeacher ? teacherFullName(otherTeacher) : null,
        reason: s.reason,
        createdAt: s.createdAt,
      }
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}
