import { join } from 'node:path'
import { type UtilityProcess, utilityProcess } from 'electron'
import type { HostToMainMessage, MainToHostMessage } from './protocol'

const ENTRY_PATH = join(__dirname, 'solver-host/entry.js')
const KILL_TIMEOUT_MS = 3000

export class SolverJob {
  private child: UtilityProcess

  constructor(
    seed: number,
    private readonly onMessage: (message: HostToMainMessage) => void,
  ) {
    this.child = utilityProcess.fork(ENTRY_PATH, [], { stdio: 'pipe' })
    this.child.on('message', (message: HostToMainMessage) => this.onMessage(message))
    this.send({ type: 'start', seed })
  }

  cancel() {
    this.send({ type: 'cancel' })
    const child = this.child
    setTimeout(() => {
      if (child.pid !== undefined) child.kill()
    }, KILL_TIMEOUT_MS)
  }

  private send(message: MainToHostMessage) {
    this.child.postMessage(message)
  }
}
