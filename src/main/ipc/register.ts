import { ipcMain } from 'electron'
import type { z } from 'zod'
import type { IpcChannel, IpcContract } from '../../shared/ipc/contract'
import { NotFoundError, OptimisticLockError } from '../db/repo/base-repo'
import { ReferencedError } from '../db/repo/reference-guard'
import { LockedEntryError, ScheduleConflictError } from '../db/repo/schedule-template'
import { err, ok, type Result } from '../../shared/result'
import type { AppError } from '../../shared/result'

/**
 * Доменные ошибки раньше схлопывались в один INTERNAL_ERROR: renderer не мог отличить
 * «кто-то успел изменить запись» от настоящего сбоя и не умел предложить перезагрузку,
 * а нарушение внешнего ключа доходило до завуча английским текстом SQLite.
 */
function toAppError(e: unknown): AppError {
  if (e instanceof OptimisticLockError) {
    return { code: 'CONFLICT', message: 'Запись изменил кто-то другой — обновите данные и повторите' }
  }
  if (e instanceof NotFoundError) {
    return { code: 'NOT_FOUND', message: e.message }
  }
  if (e instanceof ReferencedError || e instanceof LockedEntryError) {
    return { code: 'BLOCKED', message: e.message }
  }
  if (e instanceof ScheduleConflictError) {
    return { code: 'SCHEDULE_CONFLICT', message: e.message, details: e.reasons }
  }

  const message = e instanceof Error ? e.message : 'Неизвестная ошибка'
  // better-sqlite3 отдаёт нарушения целостности по-английски: показывать их как есть нельзя.
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return { code: 'BLOCKED', message: 'Запись используется в других разделах — сначала удалите или перепривяжите связанные данные' }
  }
  if (/UNIQUE constraint failed/i.test(message)) {
    return { code: 'BLOCKED', message: 'Такая запись уже есть — значение должно быть уникальным' }
  }
  if (/NOT NULL constraint failed/i.test(message)) {
    return { code: 'VALIDATION_ERROR', message: 'Не заполнено обязательное поле' }
  }
  return { code: 'INTERNAL_ERROR', message }
}

export function handle<C extends IpcChannel>(
  channel: C,
  inputSchema: z.ZodType<IpcContract[C]['in']>,
  handler: (input: IpcContract[C]['in']) => Promise<IpcContract[C]['out']> | IpcContract[C]['out'],
) {
  ipcMain.handle(channel, async (_event, rawInput): Promise<Result<IpcContract[C]['out']>> => {
    const parsed = inputSchema.safeParse(rawInput)
    if (!parsed.success) {
      // Первое сообщение выносим в message: панели без zod-резолвера (недоступность, схемы деления)
      // показывают именно его, и «Некорректные входные данные» ничего не объясняло бы завучу.
      const first = parsed.error.issues[0]
      return err<AppError>({
        code: 'VALIDATION_ERROR',
        message: first ? `Некорректные данные: ${first.message}` : 'Некорректные входные данные',
        details: parsed.error.flatten(),
      })
    }
    try {
      return ok(await handler(parsed.data))
    } catch (e) {
      return err<AppError>(toAppError(e))
    }
  })
}
