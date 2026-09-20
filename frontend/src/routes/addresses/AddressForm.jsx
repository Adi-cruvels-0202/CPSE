import { useState } from 'react';
import { useSubmit } from '../../hooks/useSubmit.js';
import { Field } from '../../components/Field.jsx';
import { FormError } from '../../components/FormError.jsx';

/**
 * The one address form — checklist 11.12 — used for both adding and editing.
 *
 * Field order follows how an Indian address is written and spoken: who it is
 * for, how to reach them, then the lines from the most specific to the least.
 * A form that asks for the postcode first makes people stop and think.
 *
 * The fields and their rules mirror the backend's schema exactly, so a customer
 * is not told about a rule only after submitting. The server is still the
 * authority — anything it rejects lands under the right input through
 * `fieldErrors`.
 */
export function AddressForm({ address, onSave, onCancel, saveLabel = 'Save address' }) {
  const [form, setForm] = useState(() => ({
    label: address?.label ?? '',
    recipientName: address?.recipientName ?? '',
    phone: address?.phone ?? '',
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    landmark: address?.landmark ?? '',
    city: address?.city ?? '',
    state: address?.state ?? '',
    postalCode: address?.postalCode ?? '',
    isDefault: address?.isDefault ?? false,
  }));

  const update = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  const { submit, pending, error, fieldErrors } = useSubmit(() => onSave(payloadFrom(form, address)));

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      noValidate
    >
      <FormError error={error} />

      <Field
        label="Who is it for?"
        name="recipientName"
        value={form.recipientName}
        onChange={update('recipientName')}
        error={fieldErrors.recipientName}
        required
        autoComplete="name"
        placeholder="Aditya Suresh"
        disabled={pending}
        autoFocus
      />

      <Field
        label="Phone"
        name="phone"
        type="tel"
        value={form.phone}
        onChange={update('phone')}
        error={fieldErrors.phone}
        hint="The shop calls this number if there is a problem with the delivery."
        required
        autoComplete="tel"
        inputMode="tel"
        placeholder="+91 98765 43210"
        disabled={pending}
      />

      <Field
        label="Flat, house or building"
        name="line1"
        value={form.line1}
        onChange={update('line1')}
        error={fieldErrors.line1}
        required
        autoComplete="address-line1"
        placeholder="221B Model Town"
        disabled={pending}
      />

      <Field
        label="Street or area"
        name="line2"
        value={form.line2}
        onChange={update('line2')}
        error={fieldErrors.line2}
        autoComplete="address-line2"
        disabled={pending}
      />

      <Field
        label="Landmark"
        name="landmark"
        value={form.landmark}
        onChange={update('landmark')}
        error={fieldErrors.landmark}
        hint="Anything that helps someone find it — “opposite the Gurudwara”."
        disabled={pending}
      />

      <Field
        label="City"
        name="city"
        value={form.city}
        onChange={update('city')}
        error={fieldErrors.city}
        required
        autoComplete="address-level2"
        disabled={pending}
      />

      <Field
        label="State"
        name="state"
        value={form.state}
        onChange={update('state')}
        error={fieldErrors.state}
        required
        autoComplete="address-level1"
        disabled={pending}
      />

      <Field
        label="PIN code"
        name="postalCode"
        value={form.postalCode}
        onChange={update('postalCode')}
        error={fieldErrors.postalCode}
        required
        autoComplete="postal-code"
        inputMode="numeric"
        placeholder="141002"
        disabled={pending}
      />

      <Field
        label="Nickname for this address"
        name="label"
        value={form.label}
        onChange={update('label')}
        error={fieldErrors.label}
        hint="Home, Office — whatever you will recognise in a list."
        disabled={pending}
      />

      <label className="address-form__default">
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(event) => update('isDefault')(event.target.checked)}
          disabled={pending}
        />
        <span>Use this as my default address</span>
      </label>

      <div className="row">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? 'Saving…' : saveLabel}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Turns the form into what the API takes.
 *
 * Two rules the backend's schema imposes, handled here so the customer never
 * sees a 422 for something the client could have got right:
 *
 *   - an optional field the customer left blank is `null` on an edit (which
 *     clears it) and simply absent on a create, because `''` fails `min(1)`;
 *   - on an edit, only changed fields are sent, since the server rejects an
 *     empty patch with "provide at least one field".
 */
export function payloadFrom(form, existing) {
  const optional = ['label', 'line2', 'landmark'];
  const payload = {};

  for (const [key, raw] of Object.entries(form)) {
    if (key === 'isDefault') continue;

    const value = typeof raw === 'string' ? raw.trim() : raw;

    if (optional.includes(key)) {
      // Blank means "no value": null to clear an existing one, omitted on create.
      if (value === '') {
        if (existing && existing[key] !== null && existing[key] !== undefined) payload[key] = null;
        continue;
      }
    }

    if (existing) {
      const before = existing[key] ?? '';
      if (value === before) continue;
    }
    payload[key] = value;
  }

  // isDefault is only worth sending when it is being turned on: the backend moves
  // the flag rather than accepting two defaults, and there is a dedicated
  // endpoint for changing it on an existing address.
  if (form.isDefault && !existing?.isDefault) payload.isDefault = true;

  return payload;
}
