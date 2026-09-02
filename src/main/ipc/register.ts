import { ipcMain } from 'electron'
import type { z } from 'zod'
import type { IpcChannel, IpcContract } from '../../shared/ipc/contract'
import { err, ok, type Result } from '../../shared/result'
import type { AppError } from '../../shared/result'

export function handle<C extends IpcChannel>(
  channel: C,
  inputSchema: z.ZodType<IpcContract[C]['in']>,
  handler: (input: IpcContract[C]['in']) => Promise<IpcContract[C]['out']> | IpcContract[C]['out'],
) {
  ipcMain.handle(channel, async (_event, rawInput): Promise<Result<IpcContract[C]['out']>> => {
    const parsed = inputSchema.safeParse(rawInput)
    if (!parsed.success) {
      return err<AppError>({ code: 'VALIDATION_ERROR', message: 'Некорректные входные данные', details: parsed.error.flatten() })
    }
    try {
      return ok(await handler(parsed.data))
    } catch (e) {
      return err<AppError>({ code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : 'Неизвестная ошибка' })
    }
  })
}
