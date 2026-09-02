import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { demoComputeCancelInput, demoComputeStartInput } from '../../shared/ipc/schemas'
import { SolverJob } from '../solver-host/manager'
import { handle } from './register'

export function registerDemoComputeHandlers(getWindow: () => BrowserWindow | null) {
  const jobs = new Map<string, SolverJob>()

  handle('demo:compute:start', demoComputeStartInput, ({ seed }) => {
    const jobId = randomUUID()
    const job = new SolverJob(seed, (message) => {
      const win = getWindow()
      if (!win) return
      if (message.type === 'progress') {
        win.webContents.send('demo:compute:progress', { jobId, ...message })
      } else {
        jobs.delete(jobId)
        win.webContents.send('demo:compute:done', { jobId, placed: message.placed, penalty: message.penalty })
      }
    })
    jobs.set(jobId, job)
    return { jobId }
  })

  handle('demo:compute:cancel', demoComputeCancelInput, ({ jobId }) => {
    jobs.get(jobId)?.cancel()
    jobs.delete(jobId)
    return { ok: true as const }
  })
}
