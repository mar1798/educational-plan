/**
 * Подсказка у погашенной кнопки: чего не хватает, чтобы действие стало доступно.
 * Без неё неактивная кнопка выглядит как сбой — завуч не видит, какое поле обязательно.
 */
export function MissingHint({ missing, action = 'сохранить' }: { missing: readonly string[]; action?: string }) {
  if (missing.length === 0) return null
  return (
    <p className="form-hint" role="status">
      Чтобы {action}, укажите: {missing.join(', ')}
    </p>
  )
}

