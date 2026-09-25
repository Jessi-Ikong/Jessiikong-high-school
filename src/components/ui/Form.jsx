import { useId } from 'react'
import '../../styles/app.css'

// Touch-friendly form controls: 48px fields, 44px+ check/radio rows, 16px
// text (so phones don't zoom in when a field is focused).

// A label + control + optional hint / error. children: a function receiving
// the props to spread on the control ({ id, 'aria-describedby', 'aria-invalid' }).
export function Field({ label, hint, error, children, className = '' }) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={`ds-field ${className}`.trim()}>
      <label className="ds-label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined })}
      {hint && (
        <span className="ds-hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="ds-error-text" id={errorId}>
          {error}
        </span>
      )}
    </div>
  )
}

export function TextInput(props) {
  return <input className="ds-input" {...props} />
}

export function TextArea(props) {
  return <textarea className="ds-textarea" {...props} />
}

export function Select({ children, ...props }) {
  return (
    <select className="ds-select" {...props}>
      {children}
    </select>
  )
}

export function Checkbox({ label, ...props }) {
  return (
    <label className="ds-check">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  )
}

// options: [{ value, label }]
export function RadioGroup({ legend, name, options, value, onChange }) {
  return (
    <fieldset className="ds-fieldset">
      <legend className="ds-label">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="ds-check">
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  )
}
