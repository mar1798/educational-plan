import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form'

interface CheckboxFieldProps<TValues extends FieldValues> {
  control: Control<TValues>
  name: FieldPath<TValues>
  label: string
}

export function CheckboxField<TValues extends FieldValues>({ control, name, label }: CheckboxFieldProps<TValues>) {
  const { field } = useController({ control, name })
  return (
    <div className="form-field form-field-checkbox">
      <input
        id={name}
        type="checkbox"
        checked={Boolean(field.value)}
        onChange={(e) => field.onChange(e.target.checked as never)}
        onBlur={field.onBlur}
      />
      <label htmlFor={name}>{label}</label>
    </div>
  )
}
