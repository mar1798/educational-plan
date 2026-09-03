import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { SolverInput, SolverOutput } from '../../solver/model'
import { generationApplyInput, generationCancelInput, generationStartInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { applySolution } from '../services/apply-solution'
import { buildSolverInput } from '../services/snapshot'
import { SolverJob } from '../solver-host/manager'
import { handle } from './register'

interface Draft {
  templateId: number
  input: SolverInput
  output: SolverOutput
}

export function registerGenerationHandlers(db: Db, getWindow: () => BrowserWindow | null) {
  const jobs = new Map<string, SolverJob>()
  const drafts = new Map<string, Draft>()

  handle('generation:start', generationStartInput, ({ templateId, seed, timeBudgetMs }) => {
    const input = db.transaction((tx) => buildSolverInput(tx, templateId, seed ?? Date.now()))
    if (timeBudgetMs != null) input.limits.timeBudgetMs = timeBudgetMs

    const jobId = randomUUID()
    const job = new SolverJob(input, (message) => {
      const win = getWindow()
      if (message.type === 'progress') {
        win?.webContents.send('generation:progress', { jobId, ...message.progress })
        return
      }
      jobs.delete(jobId)
      if (message.type === 'error') {
        win?.webContents.send('generation:failed', { jobId, message: message.message })
        return
      }
      drafts.set(jobId, { templateId, input, output: message.output })
      win?.webContents.send('generation:done', { jobId, input, output: message.output })
    })
    jobs.set(jobId, job)
    return { jobId }
  })

  handle('generation:cancel', generationCancelInput, ({ jobId }) => {
    jobs.get(jobId)?.cancel()
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
}
