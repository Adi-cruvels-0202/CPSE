import { useId, useState } from 'react';

/**
 * A labelled input with its error and hint — checklist 11.3, and the basis for
 * every form after it.
 *
 * The accessibility is the point of having a component at all: the label is
 * bound with a real `for`/`id` pair, the error is announced through
 * `aria-describedby` rather than only being visible, and `aria-invalid` tells a
 * screen reader what the red border tells everyone else.
 */
export function Field({
  label,
  name,
  type = 'text',
  value,
  onChange,
  error,
  hint,
  required = false,
  autoComplete,
  inputMode,
  placeholder,
  disabled = false,
  autoFocus = false,
  children,
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? null : <span className="field__optional"> (optional)</span>}
      </label>

      {children ?? (
        <input
          id={id}
          name={name}
          type={type}
          className="field__input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={[error ? errorId : null, hint ? hintId : null]
            .filter(Boolean)
            .join(' ') || undefined}
          autoComplete={autoComplete}
          inputMode={inputMode}
          placeholder={placeholder}
          disabled={disabled}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- only ever the
          // first field of a screen whose sole purpose is that form.
          autoFocus={autoFocus}
          required={required}
        />
      )}

      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}

      {error ? (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A password input with a show/hide toggle.
 *
 * On a phone, a masked password and a small keyboard is how people mistype and
 * then cannot see why. Revealing it is a deliberate, labelled action, and the
 * label states the current state rather than the action, so a screen reader
 * announces what is true.
 */
export function PasswordField({
  label = 'Password',
  name = 'password',
  value,
  onChange,
  error,
  hint,
  autoComplete = 'current-password',
  disabled = false,
  autoFocus = false,
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>

      <div className="field__with-action">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          className="field__input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={[error ? errorId : null, hint ? hintId : null]
            .filter(Boolean)
            .join(' ') || undefined}
          autoComplete={autoComplete}
          disabled={disabled}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
          required
        />
        <button
          type="button"
          className="field__action"
          onClick={() => setVisible((current) => !current)}
          aria-pressed={visible}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>

      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}

      {error ? (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
