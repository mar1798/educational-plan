import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form'

interface DateFieldProps<TValues extends FieldValues> {
  control: Control<TValues>
  name: FieldPath<TValues>
  label: string
  nullable?: boolean
}

export function DateField<TValues extends FieldValues>({ control, name, label, nullable }: DateFieldProps<TValues>) {
  const { field, fieldState } = useController({ control, name })
  return (
    <div className="form-field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        type="date"
        value={(field.value as string | null) ?? ''}
        onChange={(e) => field.onChange((e.target.value === '' && nullable ? null : e.target.value) as never)}
        onBlur={field.onBlur}
      />
      {fieldState.error && <p className="form-error">{fieldState.error.message}</p>}
    </div>
  )
}
