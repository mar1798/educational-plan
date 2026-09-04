import { and, eq, isNull, sql } from 'drizzle-orm'
import { describeConflict, describeConflicts, type ConflictNameResolver } from '../../../shared/schedule/messages'
import { findConflicts, type SlotEntry } from '../../../solver/validate'
import type { AuditContext } from './audit'
import { createRow, deleteRow, NotFoundError, OptimisticLockError, updateRow } from './base-repo'
import type { DbLike } from './types'
import { calendarDay, calendarPeriod, semester } from '../schema/calendar'
import { curriculumRow, discipline } from '../schema/curriculum'
import { stream, streamMember, teachingLoad } from '../schema/load'
import { pairGrid, room } from '../schema/org'
import { studyGroup, subgroup, teacher } from '../schema/people'
import { lesson, lessonGroup, scheduleTemplate, templateEntry } from '../schema/schedule'

export class ScheduleConflictError extends Error {
  constructor(
    public readonly reasons: import('../../../solver/validate').ConflictReason[],
    message: string,
  ) {
    super(message)
    this.name = 'ScheduleConflictError'
  }
}

export class LockedEntryError extends Error {}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function dayOfWeekOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

/**
 * Индекс недели семестра (0-based) для чётности §1.1 «типовая неделя»: неделя 1 (индекс 0) — нечётная.
 * Отсчёт ведётся от понедельника той недели, на которую пришлось начало семестра: иначе у семестра,
 * начинающегося не с понедельника, чётность переключалась бы посреди недели.
 */
function weekIndexInSemester(semesterStartsOn: string, date: string): number {
  const firstMonday = addDays(semesterStartsOn, -((dayOfWeekOf(semesterStartsOn) + 6) % 7))
  const diffDays = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${firstMonday}T00:00:00Z`)) / 86_400_000)
  return Math.floor(diffDays / 7)
}

/** «32 ЛД п/гр 1» — кто именно занимает слот, для текста конфликта (§4.4). */
function attendeeLabel(a: Pick<ResolvedAttendee, 'groupName' | 'subgroupNo'>): string {
  return a.subgroupNo != null ? `${a.groupName} п/гр ${a.subgroupNo}` : a.groupName
}

/** «32 ЛД («Анатомия»)» — чем занят слот у конфликтующей записи (§4.4, задача 4.4). */
export function entryLabelOf(disciplineName: string, attendees: Pick<ResolvedAttendee, 'groupName' | 'subgroupNo'>[]): string {
  const who = attendees.map(attendeeLabel).join(', ')
  return who ? `${who} («${disciplineName}»)` : `«${disciplineName}»`
}

export function nameResolver(tx: DbLike, entryLabels: Map<number, string>): ConflictNameResolver {
  return {
    entryLabel(id: number) {
      return entryLabels.get(id) ?? `занятие #${id}`
    },
    teacherName(id: number) {
      const t = tx.select().from(teacher).where(eq(teacher.id, id)).get()
      if (!t) return `преподаватель #${id}`
      const initials = [t.firstName, t.middleName].filter(Boolean).map((n) => `${(n as string)[0]}.`).join('')
      return `${t.lastName} ${initials}`
    },
    groupName(id: number) {
      return studyGroupById(tx, id)?.name ?? `группа #${id}`
    },
    roomLabel(id: number) {
      const r = tx.select().from(room).where(eq(room.id, id)).get()
      return r ? r.number : `#${id}`
    },
  }
}

export function studyGroupById(tx: DbLike, id: number) {
  return tx.select().from(studyGroup).where(eq(studyGroup.id, id)).get()
}

export interface ResolvedAttendee {
  groupId: number
  groupName: string
  subgroupId: number | null
  subgroupNo: number | null
  posFrom: number
  posTo: number
}

/**
 * Разрешение «кто присутствует» на занятие нагрузки (§4.6, §4.7): группа+подгруппа →
 * границы subgroup; группа целиком (лекция/практика без деления) → 1..N; поток →
 * каждая группа-участница целиком (подгруппы у потоков не используются, §4.7).
 */
export function resolveEntryAttendees(tx: DbLike, teachingLoadId: number): ResolvedAttendee[] {
  const load = tx.select().from(teachingLoad).where(eq(teachingLoad.id, teachingLoadId)).get()
  if (!load) throw new NotFoundError('teaching_load', teachingLoadId)

  if (load.streamId != null) {
    const members = tx
      .select()
      .from(streamMember)
      .where(and(eq(streamMember.streamId, load.streamId), isNull(streamMember.validTo)))
      .all()
    return members.map((m) => {
      const g = studyGroupById(tx, m.groupId)
      if (!g) throw new NotFoundError('study_group', m.groupId)
      return { groupId: g.id, groupName: g.name, subgroupId: null, subgroupNo: null, posFrom: 1, posTo: g.studentsCount }
    })
  }

  if (load.groupId == null) {
    throw new Error(`Строка нагрузки #${teachingLoadId}: не задана ни группа, ни поток`)
  }
  const g = studyGroupById(tx, load.groupId)
  if (!g) throw new NotFoundError('study_group', load.groupId)

  if (load.subgroupId != null) {
    const sg = tx.select().from(subgroup).where(eq(subgroup.id, load.subgroupId)).get()
    if (!sg) throw new NotFoundError('subgroup', load.subgroupId)
    return [{ groupId: g.id, groupName: g.name, subgroupId: sg.id, subgroupNo: sg.no, posFrom: sg.posFrom, posTo: sg.posTo }]
  }

  return [{ groupId: g.id, groupName: g.name, subgroupId: null, subgroupNo: null, posFrom: 1, posTo: g.studentsCount }]
}

/**
 * Справочники, нужные для разбора записей шаблона, загруженные один раз.
 *
 * Раньше `templateEntriesView`/`loadSlotEntries` делали по 7–10 запросов НА КАЖДУЮ запись:
 * на шаблоне колледжа (тысячи записей) это десятки тысяч синхронных обращений к SQLite в
 * главном процессе — и так на каждое открытие «Шаблона недели» и на каждое перетаскивание
 * занятия. Справочники малы, поэтому дешевле прочитать их целиком и собрать вид в памяти.
 */
export interface TemplateLookup {
  loads: Map<number, typeof teachingLoad.$inferSelect>
  teachers: Map<number, typeof teacher.$inferSelect>
  rows: Map<number, typeof curriculumRow.$inferSelect>
  disciplines: Map<number, typeof discipline.$inferSelect>
  rooms: Map<number, typeof room.$inferSelect>
  groups: Map<number, typeof studyGroup.$inferSelect>
  subgroups: Map<number, typeof subgroup.$inferSelect>
  streams: Map<number, typeof stream.$inferSelect>
  streamMembers: Map<number, (typeof streamMember.$inferSelect)[]>
  pairHours: Map<number, number>
}

function byId<T extends { id: number }>(rows: T[]): Map<number, T> {
  return new Map(rows.map((r) => [r.id, r]))
}

export function buildTemplateLookup(tx: DbLike): TemplateLookup {
  const members = new Map<number, (typeof streamMember.$inferSelect)[]>()
  for (const m of tx.select().from(streamMember).where(isNull(streamMember.validTo)).all()) {
    const list = members.get(m.streamId)
    if (list) list.push(m)
    else members.set(m.streamId, [m])
  }
  return {
    loads: byId(tx.select().from(teachingLoad).all()),
    teachers: byId(tx.select().from(teacher).all()),
    rows: byId(tx.select().from(curriculumRow).all()),
    disciplines: byId(tx.select().from(discipline).all()),
    rooms: byId(tx.select().from(room).all()),
    groups: byId(tx.select().from(studyGroup).all()),
    subgroups: byId(tx.select().from(subgroup).all()),
    streams: byId(tx.select().from(stream).all()),
    streamMembers: members,
    pairHours: new Map(tx.select().from(pairGrid).all().map((p) => [p.pairNo, p.academicHours])),
  }
}

/** Тот же разбор «кто присутствует», что и в `resolveEntryAttendees`, но по готовому индексу. */
export function resolveAttendeesFrom(lookup: TemplateLookup, teachingLoadId: number): ResolvedAttendee[] {
  const load = lookup.loads.get(teachingLoadId)
  if (!load) throw new NotFoundError('teaching_load', teachingLoadId)

  if (load.streamId != null) {
    return (lookup.streamMembers.get(load.streamId) ?? []).map((m) => {
      const g = lookup.groups.get(m.groupId)
      if (!g) throw new NotFoundError('study_group', m.groupId)
      return { groupId: g.id, groupName: g.name, subgroupId: null, subgroupNo: null, posFrom: 1, posTo: g.studentsCount }
    })
  }

  if (load.groupId == null) {
    throw new Error(`Строка нагрузки #${teachingLoadId}: не задана ни группа, ни поток`)
  }
  const g = lookup.groups.get(load.groupId)
  if (!g) throw new NotFoundError('study_group', load.groupId)

  if (load.subgroupId != null) {
    const sg = lookup.subgroups.get(load.subgroupId)
    if (!sg) throw new NotFoundError('subgroup', load.subgroupId)
    return [{ groupId: g.id, groupName: g.name, subgroupId: sg.id, subgroupNo: sg.no, posFrom: sg.posFrom, posTo: sg.posTo }]
  }

  return [{ groupId: g.id, groupName: g.name, subgroupId: null, subgroupNo: null, posFrom: 1, posTo: g.studentsCount }]
}

/** Все записи шаблона в виде, пригодном для solver/validate.ts (§5.8). */
export function loadSlotEntries(tx: DbLike, templateId: number, excludeEntryId?: number): SlotEntry[] {
  const rows = tx.select().from(templateEntry).where(eq(templateEntry.templateId, templateId)).all()
  const lookup = buildTemplateLookup(tx)
  return rows
    .filter((r) => r.id !== excludeEntryId)
    .map((r) => {
      const load = lookup.loads.get(r.teachingLoadId)
      if (!load) throw new NotFoundError('teaching_load', r.teachingLoadId)
      const attendees = resolveAttendeesFrom(lookup, r.teachingLoadId).map((a) => ({ groupId: a.groupId, posFrom: a.posFrom, posTo: a.posTo }))
      return { id: r.id, dayOfWeek: r.dayOfWeek, pairNo: r.pairNo, weekParity: r.weekParity, teacherId: load.teacherId, roomId: r.roomId, attendees }
    })
}

export interface TemplateEntryView {
  id: number
  templateId: number
  dayOfWeek: number
  pairNo: number
  weekParity: 'all' | 'odd' | 'even'
  isLocked: boolean
  source: 'solver' | 'manual'
  roomId: number | null
  roomLabel: string | null
  teacherId: number
  teacherName: string
  teachingLoadId: number
  disciplineId: number
  disciplineName: string
  lessonKind: 'theory' | 'practice' | 'seminar' | 'lab'
  academicHours: number
  targetLabel: string
  attendees: ResolvedAttendee[]
  rowVersion: number
}

function targetLabelOf(lookup: TemplateLookup, load: { groupId: number | null; streamId: number | null }): string {
  if (load.groupId != null) return lookup.groups.get(load.groupId)?.name ?? `группа #${load.groupId}`
  const s = load.streamId != null ? lookup.streams.get(load.streamId) : undefined
  return s ? s.name : `поток #${load.streamId}`
}

/** Все записи шаблона одним запросом-обходом, с уже разрешёнными именами и attendees (§4.6 PLAN.md, задача 4.6). */
export function templateEntriesView(tx: DbLike, templateId: number): TemplateEntryView[] {
  const entries = tx.select().from(templateEntry).where(eq(templateEntry.templateId, templateId)).all()
  const lookup = buildTemplateLookup(tx)
  const pairHours = lookup.pairHours

  return entries.map((e) => {
    const load = lookup.loads.get(e.teachingLoadId)
    if (!load) throw new NotFoundError('teaching_load', e.teachingLoadId)
    const t = lookup.teachers.get(load.teacherId)
    const row = lookup.rows.get(load.curriculumRowId)
    const disc = row ? lookup.disciplines.get(row.disciplineId) : undefined
    const r = e.roomId != null ? lookup.rooms.get(e.roomId) : undefined

    return {
      id: e.id,
      templateId: e.templateId,
      dayOfWeek: e.dayOfWeek,
      pairNo: e.pairNo,
      weekParity: e.weekParity,
      isLocked: e.isLocked,
      source: e.source,
      roomId: e.roomId,
      roomLabel: r ? r.number : null,
      teacherId: load.teacherId,
      teacherName: t ? `${t.lastName} ${t.firstName}` : `#${load.teacherId}`,
      teachingLoadId: load.id,
      disciplineId: disc?.id ?? 0,
      disciplineName: disc?.name ?? '—',
      lessonKind: load.lessonKind,
      academicHours: pairHours.get(e.pairNo) ?? 2,
      targetLabel: targetLabelOf(lookup, load),
      attendees: resolveAttendeesFrom(lookup, e.teachingLoadId),
      rowVersion: e.rowVersion,
    }
  })
}

/** Подписи всех записей шаблона для текста конфликта — строится только когда конфликт уже найден. */
function templateEntryLabels(tx: DbLike, templateId: number): Map<number, string> {
  return new Map(templateEntriesView(tx, templateId).map((e) => [e.id, entryLabelOf(e.disciplineName, e.attendees)]))
}

export interface UnassignedLoadRow {
  teachingLoadId: number
  teacherId: number
  teacherName: string
  disciplineName: string
  targetLabel: string
  lessonKind: 'theory' | 'practice' | 'seminar' | 'lab'
  hoursPlanned: number
  hoursAssigned: number
  hoursRemaining: number
  attendees: ResolvedAttendee[]
}

/**
 * «Сколько ещё не поставлено» (§4.3, задача 4.3): часы записи нагрузки минус уже
 * расставленные в шаблоне (пара × часы_пары × недели × коэффициент чётности).
 * Это ориентир для завуча, а не точная бухгалтерия — точный учёт часов и их
 * исчерпание до нуля делает солвер этапа 5.
 */
export function unassignedLoadForTemplate(tx: DbLike, templateId: number): UnassignedLoadRow[] {
  const tmpl = tx.select().from(scheduleTemplate).where(eq(scheduleTemplate.id, templateId)).get()
  if (!tmpl) throw new NotFoundError('schedule_template', templateId)
  const sem = tx.select().from(semester).where(eq(semester.id, tmpl.semesterId)).get()
  if (!sem) throw new NotFoundError('semester', tmpl.semesterId)

  const lookup = buildTemplateLookup(tx)
  const pairHours = lookup.pairHours
  const entries = tx.select().from(templateEntry).where(eq(templateEntry.templateId, templateId)).all()

  const assignedByLoad = new Map<number, number>()
  for (const e of entries) {
    const perOccurrence = (pairHours.get(e.pairNo) ?? 2) * sem.weeksCount * (e.weekParity === 'all' ? 1 : 0.5)
    assignedByLoad.set(e.teachingLoadId, (assignedByLoad.get(e.teachingLoadId) ?? 0) + perOccurrence)
  }

  const loads = tx
    .select()
    .from(teachingLoad)
    .where(and(eq(teachingLoad.semesterId, tmpl.semesterId), isNull(teachingLoad.validTo)))
    .all()

  const result: UnassignedLoadRow[] = []
  for (const load of loads) {
    const assigned = assignedByLoad.get(load.id) ?? 0
    const remaining = load.hoursPlanned - assigned
    if (remaining <= 0) continue

    const t = lookup.teachers.get(load.teacherId)
    const row = lookup.rows.get(load.curriculumRowId)
    const disc = row ? lookup.disciplines.get(row.disciplineId) : undefined

    result.push({
      teachingLoadId: load.id,
      teacherId: load.teacherId,
      teacherName: t ? `${t.lastName} ${t.firstName}` : `#${load.teacherId}`,
      disciplineName: disc?.name ?? '—',
      targetLabel: targetLabelOf(lookup, load),
      lessonKind: load.lessonKind,
      hoursPlanned: load.hoursPlanned,
      hoursAssigned: Math.round(assigned),
      hoursRemaining: Math.round(remaining),
      attendees: resolveAttendeesFrom(lookup, load.id),
    })
  }
  return result
}

export function listTemplates(tx: DbLike, semesterId: number): Record<string, unknown>[] {
  return tx.select().from(scheduleTemplate).where(eq(scheduleTemplate.semesterId, semesterId)).orderBy(scheduleTemplate.versionNo).all() as Record<
    string,
    unknown
  >[]
}

export interface CreateTemplateInput {
  semesterId: number
  effectiveFrom: string
  note: string | null
  copyFromTemplateId?: number | null
}

/** Создание версии шаблона (§4.1, задача 4.1): опционально клонирует записи из предыдущей версии. */
export function createTemplate(tx: DbLike, input: CreateTemplateInput, ctx: AuditContext = {}): Record<string, unknown> {
  const sem = tx.select().from(semester).where(eq(semester.id, input.semesterId)).get()
  if (!sem) throw new NotFoundError('semester', input.semesterId)

  const maxVersion = tx
    .select({ n: sql<number>`coalesce(max(${scheduleTemplate.versionNo}), 0)` })
    .from(scheduleTemplate)
    .where(eq(scheduleTemplate.semesterId, input.semesterId))
    .get() as { n: number }

  const created = createRow(
    tx,
    scheduleTemplate,
    {
      semesterId: input.semesterId,
      versionNo: maxVersion.n + 1,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
      status: 'draft',
      basedOnId: input.copyFromTemplateId ?? null,
      note: input.note,
    },
    ctx,
  )

  if (input.copyFromTemplateId != null) {
    const sourceEntries = tx.select().from(templateEntry).where(eq(templateEntry.templateId, input.copyFromTemplateId)).all()
    for (const e of sourceEntries) {
      createRow(
        tx,
        templateEntry,
        {
          templateId: created.id as number,
          dayOfWeek: e.dayOfWeek,
          pairNo: e.pairNo,
          teachingLoadId: e.teachingLoadId,
          roomId: e.roomId,
          weekParity: e.weekParity,
          isLocked: e.isLocked,
          source: e.source,
        },
        ctx,
      )
    }
  }

  return created
}

/** Активация версии (§4.1): закрывает предыдущую активную версию семестра днём раньше даты вступления новой в силу. */
export function activateTemplate(tx: DbLike, id: number, rowVersion: number, ctx: AuditContext = {}): Record<string, unknown> {
  const tmpl = tx.select().from(scheduleTemplate).where(eq(scheduleTemplate.id, id)).get()
  if (!tmpl) throw new NotFoundError('schedule_template', id)

  const siblings = tx
    .select()
    .from(scheduleTemplate)
    .where(and(eq(scheduleTemplate.semesterId, tmpl.semesterId), eq(scheduleTemplate.status, 'active')))
    .all()
  for (const s of siblings) {
    if (s.id !== id && s.effectiveFrom < tmpl.effectiveFrom && (s.effectiveTo == null || s.effectiveTo >= tmpl.effectiveFrom)) {
      updateRow(tx, scheduleTemplate, s.id, { effectiveTo: addDays(tmpl.effectiveFrom, -1) }, s.rowVersion, ctx)
    }
  }

  return updateRow(tx, scheduleTemplate, id, { status: 'active' }, rowVersion, ctx)
}

export function archiveTemplate(tx: DbLike, id: number, rowVersion: number, ctx: AuditContext = {}): Record<string, unknown> {
  return updateRow(tx, scheduleTemplate, id, { status: 'archived' }, rowVersion, ctx)
}

export interface PlaceEntryInput {
  templateId: number
  teachingLoadId: number
  dayOfWeek: number
  pairNo: number
  weekParity: 'all' | 'odd' | 'even'
  roomId: number | null
}

/** Постановка занятия в шаблон (§4.2–4.5, задачи 4.2, 4.5): авторитетная проверка конфликтов перед записью. */
export function placeEntry(tx: DbLike, input: PlaceEntryInput, ctx: AuditContext = {}): Record<string, unknown> {
  const load = tx.select().from(teachingLoad).where(eq(teachingLoad.id, input.teachingLoadId)).get()
  if (!load) throw new NotFoundError('teaching_load', input.teachingLoadId)

  const attendees = resolveEntryAttendees(tx, input.teachingLoadId).map((a) => ({ groupId: a.groupId, posFrom: a.posFrom, posTo: a.posTo }))
  const candidate: SlotEntry = {
    id: -1,
    dayOfWeek: input.dayOfWeek,
    pairNo: input.pairNo,
    weekParity: input.weekParity,
    teacherId: load.teacherId,
    roomId: input.roomId,
    attendees,
  }

  const conflicts = findConflicts(candidate, loadSlotEntries(tx, input.templateId))
  if (conflicts.length > 0) {
    throw new ScheduleConflictError(conflicts, describeConflicts(conflicts, nameResolver(tx, templateEntryLabels(tx, input.templateId))))
  }

  return createRow(
    tx,
    templateEntry,
    {
      templateId: input.templateId,
      dayOfWeek: input.dayOfWeek,
      pairNo: input.pairNo,
      teachingLoadId: input.teachingLoadId,
      roomId: input.roomId,
      weekParity: input.weekParity,
      isLocked: false,
      source: 'manual',
    },
    ctx,
  )
}

export interface MoveEntryInput {
  id: number
  rowVersion: number
  dayOfWeek: number
  pairNo: number
  weekParity: 'all' | 'odd' | 'even'
  roomId: number | null
}

/** Перенос/правка уже стоящего занятия (§4.2, §4.5): та же авторитетная проверка, закреплённые не двигаются. */
export function moveEntry(tx: DbLike, input: MoveEntryInput, ctx: AuditContext = {}): Record<string, unknown> {
  const existing = tx.select().from(templateEntry).where(eq(templateEntry.id, input.id)).get()
  if (!existing) throw new NotFoundError('template_entry', input.id)
  if (existing.isLocked) throw new LockedEntryError(`Занятие #${input.id} закреплено — сначала снимите закрепление`)

  const load = tx.select().from(teachingLoad).where(eq(teachingLoad.id, existing.teachingLoadId)).get()
  if (!load) throw new NotFoundError('teaching_load', existing.teachingLoadId)

  const attendees = resolveEntryAttendees(tx, existing.teachingLoadId).map((a) => ({ groupId: a.groupId, posFrom: a.posFrom, posTo: a.posTo }))
  const candidate: SlotEntry = {
    id: existing.id,
    dayOfWeek: input.dayOfWeek,
    pairNo: input.pairNo,
    weekParity: input.weekParity,
    teacherId: load.teacherId,
    roomId: input.roomId,
    attendees,
  }

  const conflicts = findConflicts(candidate, loadSlotEntries(tx, existing.templateId, existing.id))
  if (conflicts.length > 0) {
    throw new ScheduleConflictError(conflicts, describeConflicts(conflicts, nameResolver(tx, templateEntryLabels(tx, existing.templateId))))
  }

  return updateRow(
    tx,
    templateEntry,
    input.id,
    { dayOfWeek: input.dayOfWeek, pairNo: input.pairNo, weekParity: input.weekParity, roomId: input.roomId },
    input.rowVersion,
    ctx,
  )
}

export function setEntryLocked(tx: DbLike, id: number, rowVersion: number, isLocked: boolean, ctx: AuditContext = {}): Record<string, unknown> {
  return updateRow(tx, templateEntry, id, { isLocked }, rowVersion, ctx)
}

/**
 * Снятие занятия обратно в панель нагрузки (задача 4.3): закреплённое сначала нужно раскрепить.
 *
 * Уже материализованные занятия ссылаются на запись шаблона с `on delete restrict`, поэтому
 * связь разрывается заранее: сама история проведённых занятий сохраняется, а запланированные
 * следующая раскатка отменит как осиротевшие (они остаются привязанными к версии шаблона).
 */
export function removeEntry(tx: DbLike, id: number, rowVersion: number, ctx: AuditContext = {}): void {
  const existing = tx.select().from(templateEntry).where(eq(templateEntry.id, id)).get()
  if (!existing) throw new NotFoundError('template_entry', id)
  if (existing.rowVersion !== rowVersion) throw new OptimisticLockError('template_entry', id)
  if (existing.isLocked) throw new LockedEntryError(`Занятие #${id} закреплено — сначала снимите закрепление`)

  for (const l of tx.select().from(lesson).where(eq(lesson.templateEntryId, id)).all()) {
    updateRow(tx, lesson, l.id, { templateEntryId: null }, l.rowVersion, ctx)
  }
  deleteRow(tx, templateEntry, id, ctx)
}

/**
 * Тот же предикат, но по один раз загруженным периодам и с памятью на пару (группа, дата).
 * В `planRollout` он вызывается на каждой паре (дата × запись шаблона × слушатель): для
 * семестра это сотни тысяч вызовов, и запрос к `calendar_period` внутри каждого делал
 * раскатку самой долгой операцией приложения.
 */
function nonTheoryPeriodChecker(tx: DbLike): (groupId: number, date: string) => boolean {
  const groups = new Map(tx.select().from(studyGroup).all().map((g) => [g.id, g]))
  const periods = tx.select().from(calendarPeriod).where(sql`${calendarPeriod.kind} != 'theory'`).all()
  const cache = new Map<string, boolean>()

  return (groupId, date) => {
    const key = `${groupId}#${date}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached

    const g = groups.get(groupId)
    const result =
      g != null &&
      periods.some(
        (p) =>
          p.startsOn <= date &&
          p.endsOn >= date &&
          (p.groupId == null || p.groupId === groupId) &&
          (p.specialityId == null || p.specialityId === g.specialityId) &&
          (p.course == null || p.course === g.course),
      )
    cache.set(key, result)
    return result
  }
}

export interface RolloutChangeItem {
  date: string
  entryId: number
  action: 'create' | 'update' | 'cancel'
  description: string
}

type RolloutAction =
  | { kind: 'create'; date: string; entry: TemplateEntryView }
  | { kind: 'update'; date: string; entry: TemplateEntryView; lessonId: number }
  | { kind: 'cancel'; lessonId: number }

export interface RolloutPlan {
  templateId: number
  dateFrom: string
  dateTo: string
  toCreate: number
  toUpdate: number
  toCancel: number
  items: RolloutChangeItem[]
  actions: RolloutAction[]
}

/**
 * Ядро раскатки (§4.8–4.10, задачи 4.8–4.10): dry-run, ничего не пишет. Диапазон
 * обрезается снизу до effective_from шаблона, held-занятия и уже прошедшее не трогаются.
 *
 * В диапазоне рассматриваются занятия всех шаблонов этого семестра, а не только
 * раскатываемого: иначе занятия, оставшиеся от прежней версии шаблона или от записи,
 * которую с тех пор перенесли или убрали, остались бы в расписании навсегда — и новая
 * раскатка упёрлась бы в уникальный индекс «преподаватель × дата × пара».
 */
export function planRollout(tx: DbLike, input: { templateId: number; dateFrom: string; dateTo: string }): RolloutPlan {
  const tmpl = tx.select().from(scheduleTemplate).where(eq(scheduleTemplate.id, input.templateId)).get()
  if (!tmpl) throw new NotFoundError('schedule_template', input.templateId)
  const sem = tx.select().from(semester).where(eq(semester.id, tmpl.semesterId)).get()
  if (!sem) throw new NotFoundError('semester', tmpl.semesterId)

  const from = input.dateFrom > tmpl.effectiveFrom ? input.dateFrom : tmpl.effectiveFrom
  const to = input.dateTo
  const entries = templateEntriesView(tx, input.templateId)
  const isNonTheory = nonTheoryPeriodChecker(tx)

  const rangeLessons = tx
    .select({ l: lesson })
    .from(lesson)
    .innerJoin(scheduleTemplate, eq(lesson.templateId, scheduleTemplate.id))
    .where(
      and(
        sql`${lesson.date} >= ${from}`,
        sql`${lesson.date} <= ${to}`,
        sql`${lesson.status} in ('planned','held')`,
        eq(scheduleTemplate.semesterId, tmpl.semesterId),
      ),
    )
    .all()
    .map((r) => r.l)

  // Занятие узнаётся по своей записи шаблона, а если её версия сменилась — по слоту и
  // строке нагрузки: так неизменившееся занятие переживает смену версии, а не пересоздаётся.
  const byEntryDate = new Map<string, (typeof rangeLessons)[number]>()
  const bySlotLoad = new Map<string, (typeof rangeLessons)[number]>()
  for (const l of rangeLessons) {
    if (l.templateEntryId != null) byEntryDate.set(`${l.date}#${l.templateEntryId}`, l)
    bySlotLoad.set(`${l.date}#${l.pairNo}#${l.teachingLoadId}`, l)
  }
  const accounted = new Set<number>()

  const items: RolloutChangeItem[] = []
  const actions: RolloutAction[] = []
  let toCreate = 0
  let toUpdate = 0
  let toCancel = 0

  const calendarDaysInRange = new Map(
    tx
      .select()
      .from(calendarDay)
      .where(and(sql`${calendarDay.date} >= ${from}`, sql`${calendarDay.date} <= ${to}`))
      .all()
      .map((d) => [d.date, d]),
  )

  for (let date = from; date <= to; date = addDays(date, 1)) {
    const calDay = calendarDaysInRange.get(date)
    if (calDay && (calDay.kind === 'holiday' || calDay.kind === 'vacation' || calDay.kind === 'weekend')) continue

    const dow = calDay?.kind === 'moved_workday' && calDay.movedFromDate ? dayOfWeekOf(calDay.movedFromDate) : dayOfWeekOf(date)
    if (dow === 0) continue

    const weekIdx = weekIndexInSemester(sem.startsOn, date)
    const parityOfWeek: 'odd' | 'even' = weekIdx % 2 === 0 ? 'odd' : 'even'

    for (const entry of entries) {
      if (entry.dayOfWeek !== dow) continue
      if (entry.weekParity !== 'all' && entry.weekParity !== parityOfWeek) continue

      const existingLesson = byEntryDate.get(`${date}#${entry.id}`) ?? bySlotLoad.get(`${date}#${entry.pairNo}#${entry.teachingLoadId}`)
      if (existingLesson) accounted.add(existingLesson.id)
      if (existingLesson?.status === 'held') continue

      const onNonTheoryPeriod = entry.attendees.some((a) => isNonTheory(a.groupId, date))

      if (onNonTheoryPeriod) {
        if (existingLesson) {
          toCancel++
          items.push({ date, entryId: entry.id, action: 'cancel', description: `${date}: отменится «${entry.disciplineName}» (${entry.targetLabel}) — практика/сессия` })
          actions.push({ kind: 'cancel', lessonId: existingLesson.id })
        }
        continue
      }

      if (!existingLesson) {
        toCreate++
        items.push({ date, entryId: entry.id, action: 'create', description: `${date}: добавится «${entry.disciplineName}» (${entry.targetLabel}, ${entry.teacherName})` })
        actions.push({ kind: 'create', date, entry })
        continue
      }

      const changed =
        existingLesson.teacherId !== entry.teacherId ||
        existingLesson.roomId !== entry.roomId ||
        existingLesson.disciplineId !== entry.disciplineId ||
        existingLesson.templateEntryId !== entry.id ||
        existingLesson.templateId !== input.templateId
      if (changed) {
        toUpdate++
        items.push({ date, entryId: entry.id, action: 'update', description: `${date}: изменится «${entry.disciplineName}» (${entry.targetLabel})` })
        actions.push({ kind: 'update', date, entry, lessonId: existingLesson.id })
      }
    }
  }

  // Всё, что осталось от прежнего шаблона: перенесённые, снятые или попавшие на
  // выходной/праздник занятия — их больше нет в раскатываемом шаблоне (задача 4.9).
  const labels = new Map(entries.map((e) => [e.id, `«${e.disciplineName}» (${e.targetLabel})`]))
  for (const l of rangeLessons) {
    if (accounted.has(l.id) || l.status !== 'planned') continue
    toCancel++
    const what = (l.templateEntryId != null ? labels.get(l.templateEntryId) : undefined) ?? lessonLabel(tx, l)
    items.push({ date: l.date, entryId: l.templateEntryId ?? 0, action: 'cancel', description: `${l.date}: отменится ${what} — его больше нет в шаблоне` })
    actions.push({ kind: 'cancel', lessonId: l.id })
  }

  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return { templateId: input.templateId, dateFrom: from, dateTo: to, toCreate, toUpdate, toCancel, items, actions }
}

/** Применение плана раскатки (задача 4.9): вызывающая сторона оборачивает это в runOperation(kind: 'rollout'). */
export function applyRollout(tx: DbLike, plan: RolloutPlan, ctx: AuditContext): { created: number; updated: number; cancelled: number } {
  let created = 0
  let updated = 0
  let cancelled = 0

  // Отмены выполняются первыми: занятие, освобождающее слот, должно уйти из-под
  // уникального индекса «преподаватель × дата × пара» раньше, чем встанет новое.
  const ordered = [...plan.actions].sort((a, b) => Number(a.kind !== 'cancel') - Number(b.kind !== 'cancel'))

  for (const action of ordered) {
    if (action.kind === 'create') {
      const entry = action.entry
      const lessonRow = createRow(
        tx,
        lesson,
        {
          date: action.date,
          pairNo: entry.pairNo,
          teachingLoadId: entry.teachingLoadId,
          teacherId: entry.teacherId,
          roomId: entry.roomId,
          disciplineId: entry.disciplineId,
          lessonKind: entry.lessonKind,
          academicHours: entry.academicHours,
          templateEntryId: entry.id,
          templateId: plan.templateId,
          status: 'planned',
          operationId: ctx.operationId!,
        },
        ctx,
      )
      for (const a of entry.attendees) {
        createRow(tx, lessonGroup, { lessonId: lessonRow.id as number, groupId: a.groupId, subgroupId: a.subgroupId, posFrom: a.posFrom, posTo: a.posTo }, ctx)
      }
      created++
    } else if (action.kind === 'update') {
      const entry = action.entry
      const before = tx.select().from(lesson).where(eq(lesson.id, action.lessonId)).get()!
      updateRow(
        tx,
        lesson,
        action.lessonId,
        {
          teacherId: entry.teacherId,
          roomId: entry.roomId,
          disciplineId: entry.disciplineId,
          lessonKind: entry.lessonKind,
          academicHours: entry.academicHours,
          templateEntryId: entry.id,
          templateId: plan.templateId,
        },
        before.rowVersion,
        ctx,
      )
      for (const og of tx.select().from(lessonGroup).where(eq(lessonGroup.lessonId, action.lessonId)).all()) {
        deleteRow(tx, lessonGroup, og.id, ctx)
      }
      for (const a of entry.attendees) {
        createRow(tx, lessonGroup, { lessonId: action.lessonId, groupId: a.groupId, subgroupId: a.subgroupId, posFrom: a.posFrom, posTo: a.posTo }, ctx)
      }
      updated++
    } else {
      const before = tx.select().from(lesson).where(eq(lesson.id, action.lessonId)).get()!
      updateRow(tx, lesson, action.lessonId, { status: 'cancelled' }, before.rowVersion, ctx)
      cancelled++
    }
  }

  return { created, updated, cancelled }
}

export interface LessonConflictView {
  date: string
  dayOfWeek: number
  pairNo: number
  description: string
  lessonAId: number
  lessonBId: number
  /** Куда вести завуча из списка конфликтов (задача 4.11): семестр, версия шаблона и группа для разреза. */
  semesterId: number | null
  templateId: number | null
  groupId: number | null
}

/** Подпись материализованного занятия для текста конфликта — тот же формат, что и у записи шаблона. */
export function lessonLabel(tx: DbLike, l: { id: number; disciplineId: number }): string {
  const disc = tx.select().from(discipline).where(eq(discipline.id, l.disciplineId)).get()
  const attendees = tx
    .select()
    .from(lessonGroup)
    .where(eq(lessonGroup.lessonId, l.id))
    .all()
    .map((lg) => ({
      groupName: studyGroupById(tx, lg.groupId)?.name ?? `группа #${lg.groupId}`,
      subgroupNo: lg.subgroupId != null ? (tx.select().from(subgroup).where(eq(subgroup.id, lg.subgroupId)).get()?.no ?? null) : null,
    }))
  return entryLabelOf(disc?.name ?? '—', attendees)
}

/** Сканирование конфликтов среди уже материализованных занятий (§5.8, задача 4.11) — тем же модулем findConflicts. */
export function listLessonConflicts(tx: DbLike, dateFrom: string, dateTo: string): LessonConflictView[] {
  const lessons = tx
    .select()
    .from(lesson)
    .where(and(sql`${lesson.date} >= ${dateFrom}`, sql`${lesson.date} <= ${dateTo}`, sql`${lesson.status} in ('planned','held')`))
    .all()

  const byDatePair = new Map<string, typeof lessons>()
  for (const l of lessons) {
    const key = `${l.date}#${l.pairNo}`
    const arr = byDatePair.get(key) ?? []
    arr.push(l)
    byDatePair.set(key, arr)
  }

  const result: LessonConflictView[] = []
  for (const group of byDatePair.values()) {
    if (group.length < 2) continue
    const lessonById = new Map(group.map((l) => [l.id, l]))
    const slotEntries: SlotEntry[] = group.map((l) => ({
      id: l.id,
      dayOfWeek: 0,
      pairNo: l.pairNo,
      weekParity: 'all',
      teacherId: l.teacherId,
      roomId: l.roomId,
      attendees: tx
        .select()
        .from(lessonGroup)
        .where(eq(lessonGroup.lessonId, l.id))
        .all()
        .map((lg) => ({ groupId: lg.groupId, posFrom: lg.posFrom, posTo: lg.posTo })),
    }))
    const names = nameResolver(tx, new Map(group.map((l) => [l.id, lessonLabel(tx, l)])))

    for (const candidate of slotEntries) {
      for (const c of findConflicts(candidate, slotEntries)) {
        if (c.withEntryId < candidate.id) continue
        const source = lessonById.get(candidate.id)!
        const firstGroup = slotEntries.find((e) => e.id === candidate.id)?.attendees[0]?.groupId ?? null
        result.push({
          date: source.date,
          dayOfWeek: dayOfWeekOf(source.date),
          pairNo: candidate.pairNo,
          description: describeConflict(c, names),
          lessonAId: candidate.id,
          lessonBId: c.withEntryId,
          semesterId: source.templateId != null ? (tx.select().from(scheduleTemplate).where(eq(scheduleTemplate.id, source.templateId)).get()?.semesterId ?? null) : null,
          templateId: source.templateId,
          groupId: firstGroup,
        })
      }
    }
  }
  return result
}
