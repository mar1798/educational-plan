import { join } from 'node:path'
import { type UtilityProcess, utilityProcess } from 'electron'
import type { SolverInput } from '../../solver/model'
import type { HostToMainMessage, MainToHostMessage } from './protocol'

const ENTRY_PATH = join(__dirname, 'solver-host/entry.js')
// Жадная фаза (этап 5) синхронна и короткая (бюджет < 3с на полном наборе, §9.1), поэтому
// «Отмена» гарантируется принудительным убийством процесса, а не кооперативным прерыванием
// на середине вычисления — Node не обработает 'cancel' до возврата из solve(). Это станет
// важнее в этапе 6 (localSearch — многосекундный, будет чанковаться с периодической отдачей
// управления, и тогда isCancelled() из hooks реально сработает по ходу вычисления).
const KILL_TIMEOUT_MS = 1000

export class SolverJob {
  private child: UtilityProcess | null
  private spawned = false
  private cancelled = false
  private finished = false
  private pending: MainToHostMessage[] = []

  constructor(
    input: SolverInput,
    private readonly onMessage: (message: HostToMainMessage) => void,
  ) {
    const child = utilityProcess.fork(ENTRY_PATH, [], { stdio: 'pipe' })
    this.child = child

    // До события 'spawn' у процесса ещё нет канала — сообщения, отправленные раньше,
    // теряются, поэтому 'start' ждёт в очереди.
    child.on('spawn', () => {
      this.spawned = true
      for (const message of this.pending.splice(0)) child.postMessage(message)
    })
    child.on('exit', () => {
      this.child = null
      // Процесс завершился, не прислав результат: упал или был убит. Отмену вызывающая
      // сторона уже знает, а вот падение иначе оставит экран генерации висеть навсегда.
      if (!this.finished && !this.cancelled) {
        this.finished = true
        this.onMessage({ type: 'error', message: 'Процесс генерации завершился неожиданно — попробуйте запустить ещё раз' })
      }
    })
    child.on('message', (message: HostToMainMessage) => {
      if (this.finished) return
      if (message.type !== 'progress') this.finished = true
      this.onMessage(message)
      if (message.type !== 'progress') this.terminate()
    })
    this.send({ type: 'start', input })
  }

  cancel() {
    this.cancelled = true
    this.send({ type: 'cancel' })
    setTimeout(() => this.terminate(), KILL_TIMEOUT_MS)
  }

  private terminate() {
    const child = this.child
    this.child = null
    this.pending = []
    child?.kill()
  }

  private send(message: MainToHostMessage) {
    if (!this.child) return
    if (!this.spawned) {
      this.pending.push(message)
      return
    }
    this.child.postMessage(message)
  }
}
