import { join } from 'node:path'
import { type UtilityProcess, utilityProcess } from 'electron'
import type { HostToMainMessage, MainToHostMessage } from './protocol'

const ENTRY_PATH = join(__dirname, 'solver-host/entry.js')
const KILL_TIMEOUT_MS = 3000

export class SolverJob {
  private child: UtilityProcess | null

  constructor(
    seed: number,
    private readonly onMessage: (message: HostToMainMessage) => void,
  ) {
    const child = utilityProcess.fork(ENTRY_PATH, [], { stdio: 'pipe' })
    this.child = child
    child.on('exit', () => {
      this.child = null
    })
    child.on('message', (message: HostToMainMessage) => {
      this.onMessage(message)
      // Процесс не завершается сам: слушатель parentPort держит его живым.
      // Без этого каждый запуск оставлял бы висящий процесс.
      if (message.type === 'done') this.terminate()
    })
    this.send({ type: 'start', seed })
  }

  cancel() {
    this.send({ type: 'cancel' })
    // Даём процессу шанс остановиться самому, затем снимаем принудительно.
    setTimeout(() => this.terminate(), KILL_TIMEOUT_MS)
  }

  private terminate() {
    const child = this.child
    this.child = null
    child?.kill()
  }

  private send(message: MainToHostMessage) {
    this.child?.postMessage(message)
  }
}
