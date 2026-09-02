import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form'

interface NumberFieldProps<TValues extends FieldValues> {
  control: Control<TValues>
  name: FieldPath<TValues>
  label: string
  nullable?: boolean
  min?: number
  max?: number
}

export function NumberField<TValues extends FieldValues>({ control, name, label, nullable, min, max }: NumberFieldProps<TValues>) {
  const { field, fieldState } = useController({ control, name })
  const raw = field.value == null ? '' : String(field.value)
  return (
    <div className="form-field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        type="number"
        min={min}
        max={max}
        value={raw}
        onChange={(e) => {
          const v = e.target.value
          field.onChange((v === '' ? (nullable ? null : undefined) : Number(v)) as never)
        }}
        onBlur={field.onBlur}
      />
      {fieldState.error && <p className="form-error">{fieldState.error.message}</p>}
    </div>
  )
}
