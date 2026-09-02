import { contextBridge, ipcRenderer } from 'electron'
import type { IpcContract, IpcEvents } from '../shared/ipc/contract'
import type { Result } from '../shared/result'

function invoke<C extends keyof IpcContract>(
  channel: C,
  input: IpcContract[C]['in'],
): Promise<Result<IpcContract[C]['out']>> {
  return ipcRenderer.invoke(channel, input)
}

function on<E extends keyof IpcEvents>(channel: E, listener: (payload: IpcEvents[E]) => void) {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: IpcEvents[E]) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = { invoke, on }

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
