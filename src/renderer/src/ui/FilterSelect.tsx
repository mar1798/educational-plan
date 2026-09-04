import type { ReactNode } from 'react'
import { Select } from './Select'

interface FilterSelectProps {
  /** Подпись слева от поля — что именно фильтруется. */
  label: string
  /** Пояснение во всплывающей подсказке: что произойдёт при выборе. */
  hint?: string
  value: string | number | null | undefined
  onChange: (value: string) => void
  disabled?: boolean
  children: ReactNode
}

/**
 * Поле фильтра в панели над таблицей или сеткой: подпись + список.
 *
 * Голые списки в панелях читались как загадка — «32 ЛД» в поле не объясняет, фильтр это
 * по группе или по потоку, а «Неделя» рядом можно принять за номер недели. Подпись
 * называет измерение, `title` — что изменится на экране.
 */
export function FilterSelect({ label, hint, value, onChange, disabled, children }: FilterSelectProps) {
  return (
    <label className="filter-select">
      <span className="filter-select-label">{label}</span>
      <Select value={value} onChange={onChange} disabled={disabled} aria-label={label} title={hint ?? label}>
        {children}
      </Select>
    </label>
  )
}
