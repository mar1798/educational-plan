import type { MessageEvent } from 'electron'
import { solve } from '../../solver'
import type { HostToMainMessage, MainToHostMessage } from './protocol'

function post(message: HostToMainMessage) {
  process.parentPort.postMessage(message)
}

let cancelled = false

function run(input: Parameters<typeof solve>[0]) {
  cancelled = false
  try {
    const output = solve(input, {
      onProgress: (progress) => post({ type: 'progress', progress }),
      isCancelled: () => cancelled,
    })
    post({ type: 'done', output })
  } catch (error) {
    // Иначе исключение убило бы процесс молча и экран генерации завис бы на прогрессе.
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

process.parentPort.on('message', (event: MessageEvent) => {
  const message = event.data as MainToHostMessage
  if (message.type === 'start') {
    run(message.input)
  } else if (message.type === 'cancel') {
    cancelled = true
  }
})
