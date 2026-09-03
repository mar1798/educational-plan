import { and, eq, isNull } from 'drizzle-orm'
import { stream, streamMember, teachingLoad } from '../schema/load'
import { studyGroup } from '../schema/people'
import { lesson } from '../schema/schedule'
import type { AuditContext } from './audit'
import { createRow, deleteRow, NotFoundError } from './base-repo'
import { ensureDeletable } from './reference-guard'
import type { DbLike } from './types'

export class StreamValidationError extends Error {}

export interface StreamRow {
  id: number
  semesterId: number
  name: string
  validFrom: string
  validTo: string | null
  rowVersion: number
}

export interface StreamMemberRow {
  id: number
  streamId: number
  groupId: number
  validFrom: string
  validTo: string | null
  rowVersion: number
}

export function listStreamsWithMembers(tx: DbLike, semesterId: number): (StreamRow & { members: StreamMemberRow[] })[] {
  const streams = tx.select().from(stream).where(eq(stream.semesterId, semesterId)).all()
  return streams.map((s) => ({
    ...s,
    members: tx.select().from(streamMember).where(eq(streamMember.streamId, s.id)).all(),
  })) as unknown as (StreamRow & { members: StreamMemberRow[] })[]
}

/**
 * Создание потока (§3.5a): лекционная нагрузка на несколько групп одной специальности
 * и курса. Состав задаётся при создании; изменить его можно расформированием потока
 * (нагрузка распадается на группы) и созданием нового — отдельного редактирования
 * состава этап 3 не требует.
 */
export function createStream(
  tx: DbLike,
  params: { semesterId: number; name: string; groupIds: number[]; validFrom: string },
  ctx: AuditContext = {},
): StreamRow & { members: StreamMemberRow[] } {
  if (params.groupIds.length < 2) {
    throw new StreamValidationError('В поток нужно выбрать минимум 2 группы')
  }

  const groups = params.groupIds.map((id) => {
    const g = tx.select().from(studyGroup).where(eq(studyGroup.id, id)).get()
    if (!g) throw new NotFoundError('study_group', id)
    return g
  })

  const first = groups[0]!
  for (const g of groups.slice(1)) {
    if (g.specialityId !== first.specialityId || g.course !== first.course) {
      throw new StreamValidationError(
        `Группа «${g.name}» не подходит потоку: поток объединяет группы только одной специальности и курса (как «${first.name}»)`,
      )
    }
  }

  const created = createRow(tx, stream, { semesterId: params.semesterId, name: params.name, validFrom: params.validFrom }, ctx)
  for (const g of groups) {
    createRow(tx, streamMember, { streamId: created.id as number, groupId: g.id, validFrom: params.validFrom }, ctx)
  }

  return listStreamsWithMembers(tx, params.semesterId).find((s) => s.id === created.id)!
}

/**
 * Расформирование потока (§3.5a): поточные строки нагрузки распадаются на строки
 * группы-участницы с теми же часами каждая — «часы преподавателю посчитаны один раз»
 * относится к агрегату по преподавателю, а не к тому, что часы делятся между группами.
 */
export function disbandStream(tx: DbLike, streamId: number, ctx: AuditContext = {}): { createdLoadIds: number[] } {
  const s = tx.select().from(stream).where(eq(stream.id, streamId)).get()
  if (!s) throw new NotFoundError('stream', streamId)

  const members = tx.select().from(streamMember).where(and(eq(streamMember.streamId, streamId), isNull(streamMember.validTo))).all()
  const loads = tx.select().from(teachingLoad).where(and(eq(teachingLoad.streamId, streamId), isNull(teachingLoad.validTo))).all()

  // Проверяем удалимость всех поточных строк до того, как создавать замену: иначе
  // на строке с уже расставленными занятиями откат транзакции пришёлся бы на середину
  // распада потока.
  for (const load of loads) {
    ensureDeletable(tx, `Строка нагрузки потока #${load.id}`, load.id, [{ table: lesson, column: lesson.teachingLoadId, nounRu: 'занятиях' }])
  }

  const createdLoadIds: number[] = []
  for (const load of loads) {
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      rowVersion: _rowVersion,
      streamId: _streamId,
      groupId: _groupId,
      ...rest
    } = load
    for (const member of members) {
      const created = createRow(tx, teachingLoad, { ...rest, groupId: member.groupId, streamId: null }, ctx)
      createdLoadIds.push(created.id as number)
    }
    deleteRow(tx, teachingLoad, load.id, ctx)
  }

  for (const member of members) {
    deleteRow(tx, streamMember, member.id, ctx)
  }
  deleteRow(tx, stream, streamId, ctx)

  return { createdLoadIds }
}
