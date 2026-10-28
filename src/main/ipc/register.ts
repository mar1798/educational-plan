import { ipcMain } from 'electron'
import type { z } from 'zod'
import type { IpcChannel, IpcContract } from '../../shared/ipc/contract'
import { NotFoundError, OptimisticLockError } from '../db/repo/base-repo'
import { SubgroupCoverageError } from '../db/repo/division-scheme'
import { OperationDependedError, OperationNotUndoableError } from '../db/repo/operations'
import { ReferencedError } from '../db/repo/reference-guard'
import { LockedEntryError, ScheduleConflictError } from '../db/repo/schedule-template'
import { StreamValidationError } from '../db/repo/stream'
import { SubstitutionValidationError } from '../db/repo/substitution'
import { LoadValidationError } from '../db/repo/teaching-load'
import { err, ok, type Result } from '../../shared/result'
import type { AppError } from '../../shared/result'
import { describeIssue } from '../../shared/ipc/validation-messages'

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
  if (e instanceof ReferencedError || e instanceof LockedEntryError || e instanceof OperationDependedError || e instanceof OperationNotUndoableError) {
    return { code: 'BLOCKED', message: e.message }
  }
  // Предметные отказы (квалификация, лимит часов, состав потока, покрытие подгрупп) —
  // не сбой программы: без своей ветки они уходили как INTERNAL_ERROR.
  if (
    e instanceof LoadValidationError ||
    e instanceof StreamValidationError ||
    e instanceof SubstitutionValidationError ||
    e instanceof SubgroupCoverageError
  ) {
    return { code: 'VALIDATION_ERROR', message: e.message }
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
      // Сообщения выносим в message с названием поля: панели без zod-резолвера (недоступность,
      // схемы деления) показывают именно его, и «Некорректные входные данные» ничего не
      // объясняло бы завучу. Больше трёх не перечисляем — тост не должен стать простынёй.
      const issues = parsed.error.issues
      const listed = issues.slice(0, 3).map(describeIssue).join('; ')
      const more = issues.length > 3 ? ` и ещё ${issues.length - 3}` : ''
      return err<AppError>({
        code: 'VALIDATION_ERROR',
        message: issues.length > 0 ? `Не сохранено: ${listed}${more}` : 'Некорректные входные данные',
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
