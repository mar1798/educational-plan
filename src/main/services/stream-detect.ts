/**
 * Поиск поточных лекций (решение 54). Импорт нагрузки кладёт лекцию каждой группе отдельной
 * строкой, даже когда её читает один преподаватель по одной строке плана нескольким группам курса.
 * Без потока солвер ставит такие лекции в разные пары, и в сводной сетке поток не виден вовсе.
 *
 * Кандидат — строки теории целых групп одного семестра с одинаковыми строкой плана, преподавателем,
 * часами, неделями и требованиями к аудитории; группы одной специальности и курса (п. 27).
 * Объединение — по подтверждению завуча, молча ничего не сливается (как и в импорте, п. 47).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { StreamCandidate, StreamMergeResult } from '../../shared/ipc/contract'
import type { AuditContext } from '../db/repo/audit'
import { createRow, deleteRow, NotFoundError } from '../db/repo/base-repo'
import { createStream, StreamValidationError } from '../db/repo/stream'
import type { DbLike } from '../db/repo/types'
import { semester } from '../db/schema/calendar'
import { curriculumRow, discipline } from '../db/schema/curriculum'
import { stream, streamMember, teachingLoad } from '../db/schema/load'
import { studyGroup, teacher } from '../db/schema/people'
import { lesson, scheduleTemplate, templateEntry } from '../db/schema/schedule'

type LoadRow = typeof teachingLoad.$inferSelect

/** Всё, что должно совпасть, чтобы две строки были одной лекцией, прочитанной разным группам. */
function sameLectureKey(l: LoadRow, g: typeof studyGroup.$inferSelect): string {
  return [
    l.curriculumRowId,
    l.teacherId,
    l.hoursPlanned,
    l.weekFrom,
    l.weekTo,
    l.hoursPerWeek,
    l.sessionHours,
    l.roomTypeRequired,
    l.roomIdFixed,
    l.buildingIdRequired,
    l.clinicalModeOverride,
    g.specialityId,
    g.course,
  ].join('|')
}

export function detectStreamCandidates(tx: DbLike, semesterId: number): StreamCandidate[] {
  const sem = tx.select().from(semester).where(eq(semester.id, semesterId)).get()
  if (!sem) throw new NotFoundError('semester', semesterId)

  const groups = new Map(
    tx
      .select()
      .from(studyGroup)
      .all()
      .filter((g) => g.validTo == null && g.mergedIntoId == null)
      .map((g) => [g.id, g]),
  )
  const loads = tx.select().from(teachingLoad).where(and(eq(teachingLoad.semesterId, semesterId), isNull(teachingLoad.validTo))).all()
  // Параллельные подгруппы связаны друг с другом — такую строку в поток не переносим.
  const paired = new Set(loads.map((l) => l.pairedLoadId).filter((id): id is number => id != null))

  const buckets = new Map<string, LoadRow[]>()
  for (const l of loads) {
    if (l.lessonKind !== 'theory' || l.groupId == null || l.subgroupId != null || l.pairedLoadId != null || paired.has(l.id)) continue
    const g = groups.get(l.groupId)
    if (!g) continue
    const key = sameLectureKey(l, g)
    buckets.set(key, [...(buckets.get(key) ?? []), l])
  }

  const disciplineOfRow = new Map(
    tx
      .select({ id: curriculumRow.id, name: discipline.name })
      .from(curriculumRow)
      .innerJoin(discipline, eq(discipline.id, curriculumRow.disciplineId))
      .all()
      .map((r) => [r.id, r.name]),
  )
  const teacherName = new Map(tx.select().from(teacher).all().map((t) => [t.id, `${t.lastName} ${t.firstName}`.trim()]))
  const templates = new Map(tx.select().from(scheduleTemplate).where(eq(scheduleTemplate.semesterId, semesterId)).all().map((t) => [t.id, t]))

  const out: StreamCandidate[] = []
  for (const bucket of buckets.values()) {
    // Одна группа с двумя одинаковыми строками — дубль нагрузки, а не поток.
    const byGroup = new Map<number, LoadRow>()
    for (const l of bucket) if (!byGroup.has(l.groupId!)) byGroup.set(l.groupId!, l)
    if (byGroup.size < 2) continue
    const chosen = [...byGroup.values()].sort((a, b) => groups.get(a.groupId!)!.name.localeCompare(groups.get(b.groupId!)!.name, 'ru'))
    const loadIds = chosen.map((l) => l.id)

    let blocked: string | null = null
    const materialized = tx.select({ id: lesson.id }).from(lesson).where(inArray(lesson.teachingLoadId, loadIds)).get()
    if (materialized) blocked = 'занятия уже раскатаны в календарь — объедините вручную после отмены раскатки'

    let draftEntries = 0
    for (const e of tx.select().from(templateEntry).where(inArray(templateEntry.teachingLoadId, loadIds)).all()) {
      const t = templates.get(e.templateId)
      if (t?.status === 'draft') draftEntries++
      else if (!blocked) blocked = `уже стоит в действующей версии шаблона v${t?.versionNo ?? '?'} — сначала создайте новую черновую версию`
    }

    const first = chosen[0]!
    out.push({
      key: loadIds.join(','),
      loadIds,
      groupIds: chosen.map((l) => l.groupId!),
      groupNames: chosen.map((l) => groups.get(l.groupId!)!.name),
      disciplineName: disciplineOfRow.get(first.curriculumRowId) ?? `строка плана #${first.curriculumRowId}`,
      teacherName: teacherName.get(first.teacherId) ?? `преподаватель #${first.teacherId}`,
      hoursPlanned: first.hoursPlanned,
      draftEntries,
      blocked,
    })
  }
  return out.sort((a, b) => a.groupNames[0]!.localeCompare(b.groupNames[0]!, 'ru') || a.disciplineName.localeCompare(b.disciplineName, 'ru'))
}

/** Поток семестра с ровно таким составом — переиспользуем, а не плодим одинаковые потоки по каждой дисциплине. */
function findStreamWithMembers(tx: DbLike, semesterId: number, groupIds: number[]): number | null {
  const want = [...groupIds].sort((a, b) => a - b).join(',')
  for (const s of tx.select().from(stream).where(and(eq(stream.semesterId, semesterId), isNull(stream.validTo))).all()) {
    const have = tx
      .select({ g: streamMember.groupId })
      .from(streamMember)
      .where(and(eq(streamMember.streamId, s.id), isNull(streamMember.validTo)))
      .all()
      .map((r) => r.g)
      .sort((a, b) => a - b)
      .join(',')
    if (have === want) return s.id
  }
  return null
}

/**
 * Объединение выбранных кандидатов: строки групп заменяются одной строкой потока. Записи этих строк
 * в ЧЕРНОВЫХ версиях шаблона удаляются — у групп они стояли в разных парах, а поток должен встать
 * в одну; следующая генерация расставит его заново. Вызывать внутри `runOperation` — откат целиком.
 */
export function mergeStreamCandidates(tx: DbLike, semesterId: number, keys: string[], ctx: AuditContext = {}): StreamMergeResult {
  const sem = tx.select().from(semester).where(eq(semester.id, semesterId)).get()
  if (!sem) throw new NotFoundError('semester', semesterId)
  // Кандидаты пересчитываются здесь же: экрану, который мог устареть, не доверяем.
  const candidates = new Map(detectStreamCandidates(tx, semesterId).map((c) => [c.key, c]))

  const result: StreamMergeResult = { merged: 0, streamsCreated: 0, removedEntries: 0, skipped: [] }
  // Повтор ключа второй раз нашёл бы уже удалённые строки — обрабатываем каждый кандидат один раз.
  for (const key of new Set(keys)) {
    const c = candidates.get(key)
    if (!c) {
      result.skipped.push('Кандидат больше не найден — нагрузку успели изменить, обновите список')
      continue
    }
    const label = `«${c.disciplineName}» (${c.groupNames.join(', ')})`
    if (c.blocked) {
      result.skipped.push(`${label}: ${c.blocked}`)
      continue
    }

    let streamId = findStreamWithMembers(tx, semesterId, c.groupIds)
    if (streamId == null) {
      try {
        streamId = createStream(tx, { semesterId, name: c.groupNames.join(' + '), groupIds: c.groupIds, validFrom: sem.startsOn }, ctx).id
      } catch (e) {
        if (e instanceof StreamValidationError) {
          result.skipped.push(`${label}: ${e.message}`)
          continue
        }
        throw e
      }
      result.streamsCreated++
    }

    for (const e of tx.select().from(templateEntry).where(inArray(templateEntry.teachingLoadId, c.loadIds)).all()) {
      deleteRow(tx, templateEntry, e.id, ctx)
      result.removedEntries++
    }

    const loads = tx.select().from(teachingLoad).where(inArray(teachingLoad.id, c.loadIds)).all()
    const { id: _id, createdAt: _c, updatedAt: _u, rowVersion: _v, groupId: _g, streamId: _s, ...rest } = loads[0]!
    createRow(tx, teachingLoad, { ...rest, groupId: null, streamId }, ctx)
    for (const l of loads) deleteRow(tx, teachingLoad, l.id, ctx)
    result.merged++
  }
  return result
}
