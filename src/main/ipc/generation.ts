import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { SolverInput, SolverOutput } from '../../solver/model'
import { generationApplyInput, generationApplyPhasesInput, generationCancelInput, generationPhasesInput, generationStartInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { applyPhases, applySolution } from '../services/apply-solution'
import { applyPreferredSlots } from '../services/phase-stability'
import { semesterPhases } from '../services/semester-phases'
import { buildSolverInput } from '../services/snapshot'
import { scheduleTemplate } from '../db/schema/schedule'
import { eq } from 'drizzle-orm'
import { SolverJob } from '../solver-host/manager'
import { handle } from './register'

// Черновик — это снимок целого колледжа (вход + решение) на десятки мегабайт. Раньше `drafts`
// чистился только кнопками экрана генерации: уйдя с экрана и запустив расчёт заново, завуч
// оставлял прежний черновик в памяти main до перезапуска приложения.
// Все фазы семестра применяются разом, поэтому их черновики должны жить вместе.
const MAX_DRAFTS = 8

interface Draft {
  templateId: number
  /** Фаза семестра, для которой посчитан черновик (§этап Д); нет — генерация на весь семестр. */
  phase?: { weekFrom: number; weekTo: number }
  input: SolverInput
  output: SolverOutput
}

export function registerGenerationHandlers(db: Db, getWindow: () => BrowserWindow | null) {
  const jobs = new Map<string, SolverJob>()
  const drafts = new Map<string, Draft>()
  // Отменённые задания: 'cancel' долетает до хоста кооперативно, и тот всё равно присылает
  // 'done' с уже посчитанным решением. Без этой отметки поздний 'done' заново клал бы черновик
  // в `drafts` уже ПОСЛЕ того, как обработчик отмены его удалил, — снимок целого колледжа
  // оставался бы в памяти main до перезапуска, и экран генерации получал бы результат прогона,
  // который завуч отменил.
  const cancelled = new Set<string>()

  handle('generation:phases', generationPhasesInput, ({ templateId }) => {
    const tmpl = db.select().from(scheduleTemplate).where(eq(scheduleTemplate.id, templateId)).get()
    if (!tmpl) throw new Error('Версия шаблона не найдена')
    return semesterPhases(db, tmpl.semesterId)
  })

  handle('generation:start', generationStartInput, ({ templateId, seed, timeBudgetMs, weekFrom, weekTo, previousJobId }) => {
    const phase = weekFrom != null && weekTo != null ? { weekFrom, weekTo } : undefined
    const input = db.transaction((tx) => buildSolverInput(tx, templateId, seed ?? Date.now(), phase ? { from: phase.weekFrom, to: phase.weekTo } : undefined))
    const previous = previousJobId != null ? drafts.get(previousJobId) : undefined
    if (previous) applyPreferredSlots(input, previous)
    if (timeBudgetMs != null) input.limits.timeBudgetMs = timeBudgetMs

    const jobId = randomUUID()
    const job = new SolverJob(input, (message) => {
      const win = getWindow()
      if (message.type === 'progress') {
        win?.webContents.send('generation:progress', { jobId, ...message.progress })
        return
      }
      jobs.delete(jobId)
      if (cancelled.delete(jobId)) return
      if (message.type === 'error') {
        win?.webContents.send('generation:failed', { jobId, message: message.message })
        return
      }
      drafts.set(jobId, { templateId, phase, input, output: message.output })
      // Map хранит ключи в порядке вставки — самый старый черновик уходит первым.
      for (const stale of [...drafts.keys()].slice(0, Math.max(0, drafts.size - MAX_DRAFTS))) drafts.delete(stale)
      win?.webContents.send('generation:done', { jobId, input, output: message.output })
    })
    jobs.set(jobId, job)
    return { jobId }
  })

  handle('generation:cancel', generationCancelInput, ({ jobId, keepResult }) => {
    const job = jobs.get(jobId)
    if (keepResult && job) {
      // «Остановить и взять результат»: солвер тормозит кооперативно и присылает лучшее
      // найденное решение обычным 'done' — задание остаётся в `jobs`, чтобы этот 'done'
      // дошёл до обработчика и стал черновиком.
      job.cancel({ graceful: true })
      return { ok: true as const }
    }
    // Отметку ставим только пока задание живо: у уже завершённого прогона (кнопка «Отклонить»
    // на готовом черновике) 'done' больше не придёт, и запись осталась бы висеть навсегда.
    if (job) cancelled.add(jobId)
    job?.cancel()
    jobs.delete(jobId)
    // Отклонённый или отменённый черновик не должен жить в памяти main до перезапуска.
    drafts.delete(jobId)
    return { ok: true as const }
  })

  handle('generation:apply', generationApplyInput, ({ jobId }) => {
    const draft = drafts.get(jobId)
    if (!draft) throw new Error('Черновик генерации не найден — возможно, он устарел или уже применён')
    const result = applySolution(db, draft.templateId, draft)
    drafts.delete(jobId)
    return { operationId: result.operationId, created: result.created }
  })
  handle('generation:applyPhases', generationApplyPhasesInput, ({ jobIds }) => {
    const items = jobIds.map((id) => {
      const draft = drafts.get(id)
      if (!draft?.phase) throw new Error('Черновик фазы не найден — возможно, он устарел или уже применён')
      return draft
    })
    const templateId = items[0]!.templateId
    if (items.some((d) => d.templateId !== templateId)) throw new Error('Черновики относятся к разным версиям шаблона')
    const report = db.transaction((tx) => {
      const tmpl = tx.select().from(scheduleTemplate).where(eq(scheduleTemplate.id, templateId)).get()
      return semesterPhases(tx, tmpl!.semesterId)
    })
    const phases = items.map((draft) => {
      const view = report.phases.find((p) => p.weekFrom === draft.phase!.weekFrom && p.weekTo === draft.phase!.weekTo)
      if (!view) throw new Error('Фазы семестра изменились после генерации — запустите расчёт заново')
      return {
        draft,
        options: {
          effectiveFrom: view.effectiveFrom,
          note: `Фаза ${view.no}: недели ${view.weekFrom}–${view.weekTo}`,
          activeLoadIds: new Set(view.loads.map((l) => l.loadId)),
        },
      }
    })
    const result = applyPhases(db, templateId, phases)
    for (const id of jobIds) drafts.delete(id)
    return result
  })
}
