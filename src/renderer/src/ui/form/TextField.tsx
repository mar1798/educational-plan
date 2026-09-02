import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form'

interface TextFieldProps<TValues extends FieldValues> {
  control: Control<TValues>
  name: FieldPath<TValues>
  label: string
  placeholder?: string
  nullable?: boolean
}

export function TextField<TValues extends FieldValues>({ control, name, label, placeholder, nullable }: TextFieldProps<TValues>) {
  const { field, fieldState } = useController({ control, name })
  return (
    <div className="form-field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        type="text"
        placeholder={placeholder}
        value={(field.value as string | null) ?? ''}
        onChange={(e) => field.onChange((e.target.value === '' && nullable ? null : e.target.value) as never)}
        onBlur={field.onBlur}
      />
      {fieldState.error && <p className="form-error">{fieldState.error.message}</p>}
    </div>
  )
}
