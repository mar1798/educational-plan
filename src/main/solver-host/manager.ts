import { join } from 'node:path'
import { type UtilityProcess, utilityProcess } from 'electron'
import type { SolverInput } from '../../solver/model'
import type { HostToMainMessage, MainToHostMessage } from './protocol'

const ENTRY_PATH = join(__dirname, 'solver-host/entry.js')
// С этапа 6 localSearch (фаза 2) сама отдаёт event loop по ходу расчёта (§5.6), поэтому
// 'cancel' обычно обрабатывается кооперативно ещё до истечения этого таймаута. Жёсткое
// убийство процесса остаётся страховкой на случай, если процесс всё же завис (жадная фаза
// синхронна и короткая — бюджет < 3с на полном наборе, §9.1 — и тоже покрывается таймаутом).
const KILL_TIMEOUT_MS = 1000
// «Остановить и взять результат» ждёт дольше: процесс должен успеть досчитать текущую
// итерацию и прислать 'done' с лучшим решением, иначе останавливать было бы незачем.
const GRACEFUL_TIMEOUT_MS = 10_000

export class SolverJob {
  private child: UtilityProcess | null
  private spawned = false
  private cancelled = false
  private graceful = false
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
      // При graceful-остановке результата ждут — молчание оставило бы экран генерации
      // висеть на прогрессе, поэтому она сообщает об ошибке так же, как падение.
      if (!this.finished && (!this.cancelled || this.graceful)) {
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

  cancel(options: { graceful?: boolean } = {}) {
    this.cancelled = true
    this.graceful = options.graceful === true
    this.send({ type: 'cancel' })
    setTimeout(() => this.terminate(), this.graceful ? GRACEFUL_TIMEOUT_MS : KILL_TIMEOUT_MS)
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
