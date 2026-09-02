import type { MessageEvent } from 'electron'
import { solve } from '../../solver'
import type { HostToMainMessage, MainToHostMessage } from './protocol'

const TICKS = 10
const TICK_MS = 500

function post(message: HostToMainMessage) {
  process.parentPort.postMessage(message)
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

let cancelled = false

async function run(seed: number) {
  cancelled = false
  for (let i = 1; i <= TICKS; i++) {
    if (cancelled) return
    await delay(TICK_MS)
    if (cancelled) return
    post({ type: 'progress', percent: Math.round((i / TICKS) * 100), iteration: i })
  }
  const result = solve({ seed })
  post({ type: 'done', placed: result.placed, penalty: result.penalty })
}

process.parentPort.on('message', (event: MessageEvent) => {
  const message = event.data as MainToHostMessage
  if (message.type === 'start') {
    void run(message.seed)
  } else if (message.type === 'cancel') {
    cancelled = true
  }
})
