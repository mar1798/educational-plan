/**
 * Применение результата генерации (§3.5 п.6-7, §5.9 PLAN.md): черновик солвера не пишется
 * в БД сразу — он живёт в памяти main до явного «Применить». Применение создаёт новую
 * версию шаблона (locked-записи переносятся как есть, остальные — из `output.assignments`),
 * единой операцией `runOperation('generate', ...)`, поэтому откат уже даёт `operations:undo`
 * без дополнительного кода (§1.5).
 */
import { and, eq } from 'drizzle-orm'
import type { SolverInput, SolverOutput } from '../../solver/model'
import { findConflicts, type SlotEntry } from '../../solver/validate'
import type { Db } from '../db/client'
import { createRow, NotFoundError } from '../db/repo/base-repo'
import { runOperation } from '../db/repo/operations'
import { createTemplate, resolveEntryAttendees, ScheduleConflictError } from '../db/repo/schedule-template'
import { teachingLoad } from '../db/schema/load'
import { scheduleTemplate, templateEntry } from '../db/schema/schedule'

/** Границы диапазона установленных бит маски (attendee всегда — непрерывный диапазон позиций). */
function maskToRange(mask: readonly [number, number]): { from: number; to: number } | null {
  let from = -1
  let to = -1
  for (let bit = 0; bit < 64; bit++) {
    const word = bit < 32 ? mask[0] : mask[1]
    if ((word & (1 << (bit % 32))) !== 0) {
      if (from === -1) from = bit
      to = bit
    }
  }
  return from === -1 ? null : { from, to }
}

function slotToDayPair(slot: number): { day: number; pair: number } {
  return { day: Math.floor(slot / 6) + 1, pair: (slot % 6) + 1 }
}

export interface ApplySolutionResult {
  operationId: number
  created: number
  templateId: number
}

export function applySolution(db: Db, sourceTemplateId: number, draft: { input: SolverInput; output: SolverOutput }): ApplySolutionResult {
  const { operationId, result } = runOperation(db, 'generate', { sourceTemplateId }, (tx, opId) => {
    const ctx = { operationId: opId, reason: 'применение результата генерации' }

    const source = tx.select().from(scheduleTemplate).where(eq(scheduleTemplate.id, sourceTemplateId)).get()
    if (!source) throw new NotFoundError('schedule_template', sourceTemplateId)

    const created = createTemplate(
      tx,
      { semesterId: source.semesterId, effectiveFrom: source.effectiveFrom, note: 'Сгенерировано автоматически', copyFromTemplateId: null },
      ctx,
    )
    const newTemplateId = created.id as number

    const unitsById = new Map(draft.input.units.map((u) => [u.id, u]))
    const accumulated: SlotEntry[] = []
    let nextEntryId = -1
    let createdCount = 0

    // Уже стоящие (locked) записи переносятся как есть — заново не проверяются, но входят
    // в `accumulated`: сгенерированное занятие не имеет права конфликтовать и с ними.
    const lockedEntries = tx.select().from(templateEntry).where(and(eq(templateEntry.templateId, sourceTemplateId), eq(templateEntry.isLocked, true))).all()
    for (const e of lockedEntries) {
      const load = tx.select().from(teachingLoad).where(eq(teachingLoad.id, e.teachingLoadId)).get()
      if (load) {
        accumulated.push({
          id: nextEntryId--,
          dayOfWeek: e.dayOfWeek,
          pairNo: e.pairNo,
          weekParity: e.weekParity,
          teacherId: load.teacherId,
          roomId: e.roomId,
          attendees: resolveEntryAttendees(tx, e.teachingLoadId).map((a) => ({ groupId: a.groupId, posFrom: a.posFrom, posTo: a.posTo })),
        })
      }
      createRow(
        tx,
        templateEntry,
        { templateId: newTemplateId, dayOfWeek: e.dayOfWeek, pairNo: e.pairNo, teachingLoadId: e.teachingLoadId, roomId: e.roomId, weekParity: e.weekParity, isLocked: true, source: e.source },
        ctx,
      )
    }

    for (const a of draft.output.assignments) {
      const unit = unitsById.get(a.unitId)
      if (!unit) continue
      const { day, pair } = slotToDayPair(a.slot)
      const roomRow = a.roomIdx != null ? draft.input.rooms[a.roomIdx] : null
      const roomId = roomRow?.id ?? null
      const teacherRow = draft.input.teachers[unit.teacherIdx]
      if (!teacherRow) continue

      const attendees = unit.attendees
        .map((att) => {
          const range = maskToRange(att.memberMask)
          const g = draft.input.groups[att.groupIdx]
          if (!range || !g) return null
          return { groupId: g.id, posFrom: range.from + 1, posTo: range.to + 1 }
        })
        .filter((x): x is { groupId: number; posFrom: number; posTo: number } => x !== null)

      const candidate: SlotEntry = {
        id: nextEntryId--,
        dayOfWeek: day,
        pairNo: pair,
        weekParity: unit.parity,
        teacherId: teacherRow.id,
        roomId,
        attendees,
      }

      // Последний рубеж (§5.9): к этому моменту validateSolution уже должен был отсечь все
      // жёсткие нарушения — совпадение здесь означало бы ошибку в солвере или снимке.
      const conflicts = findConflicts(candidate, accumulated)
      if (conflicts.length > 0) {
        throw new ScheduleConflictError(conflicts, `Генерация вернула конфликтующее решение (юнит #${unit.id}) — сообщите разработчику`)
      }
      accumulated.push(candidate)

      createRow(
        tx,
        templateEntry,
        { templateId: newTemplateId, dayOfWeek: day, pairNo: pair, teachingLoadId: unit.loadIdx, roomId, weekParity: unit.parity, isLocked: false, source: 'solver' },
        ctx,
      )
      createdCount++
    }

    return { templateId: newTemplateId, created: createdCount }
  })

  return { operationId, created: result.created, templateId: result.templateId }
}
