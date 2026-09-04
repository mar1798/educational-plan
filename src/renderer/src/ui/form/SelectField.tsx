import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form'
import { Select } from '../Select'

interface Option {
  value: string
  label: string
}

interface SelectFieldProps<TValues extends FieldValues> {
  control: Control<TValues>
  name: FieldPath<TValues>
  label: string
  options: Option[]
  valueType?: 'string' | 'number'
  nullable?: boolean
  nullLabel?: string
}

export function SelectField<TValues extends FieldValues>({
  control,
  name,
  label,
  options,
  valueType = 'string',
  nullable,
  nullLabel = '—',
}: SelectFieldProps<TValues>) {
  const { field, fieldState } = useController({ control, name })
  const raw = field.value == null ? '' : String(field.value)
  return (
    <div className="form-field">
      <label htmlFor={name}>{label}</label>
      <Select
        id={name}
        value={raw}
        onChange={(v) => {
          if (v === '') {
            field.onChange(null as never)
            return
          }
          field.onChange((valueType === 'number' ? Number(v) : v) as never)
        }}
      >
        {nullable && <option value="">{nullLabel}</option>}
        {!nullable && raw === '' && <option value="">—</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
      {fieldState.error && <p className="form-error">{fieldState.error.message}</p>}
    </div>
  )
}
