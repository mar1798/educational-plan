import type { IpcContract, IpcEvents } from '../../../shared/ipc/contract'
import type { Result } from '../../../shared/result'

declare global {
  interface Window {
    api: {
      invoke<C extends keyof IpcContract>(channel: C, input: IpcContract[C]['in']): Promise<Result<IpcContract[C]['out']>>
      on<E extends keyof IpcEvents>(channel: E, listener: (payload: IpcEvents[E]) => void): () => void
    }
  }
}

export const api = window.api
