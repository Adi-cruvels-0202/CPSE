/**
 * One saved address — checklist 11.12.
 *
 * Also used by checkout to pick one (11.8), so it takes a `selectable` mode
 * rather than existing twice: the same address rendered two different ways in two
 * places is how the two drift apart.
 */
export function AddressCard({
  address,
  onEdit,
  onDelete,
  onMakeDefault,
  selectable = false,
  selected = false,
  onSelect,
  busy = false,
}) {
  const lines = [address.line1, address.line2, address.landmark].filter(Boolean);
  const place = [address.city, address.state, address.postalCode].filter(Boolean).join(', ');

  const body = (
    <>
      <div className="address__head">
        <span className="address__name">{address.recipientName}</span>
        {address.label ? <span className="badge badge--neutral">{address.label}</span> : null}
        {address.isDefault ? <span className="badge">Default</span> : null}
      </div>

      <address className="address__lines">
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
        {place ? <span>{place}</span> : null}
        <span className="address__phone numeric">{address.phone}</span>
      </address>
    </>
  );

  if (selectable) {
    return (
      <label className={`address address--selectable${selected ? ' address--selected' : ''}`}>
        <input
          type="radio"
          name="address"
          value={address.id}
          checked={selected}
          onChange={() => onSelect?.(address)}
          disabled={busy}
        />
        <span className="address__body">{body}</span>
      </label>
    );
  }

  return (
    <li className="address">
      <div className="address__body">{body}</div>

      <div className="address__actions">
        {!address.isDefault && onMakeDefault ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onMakeDefault(address)}
            disabled={busy}
          >
            Make default
          </button>
        ) : null}

        {onEdit ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onEdit(address)}
            disabled={busy}
          >
            Edit
          </button>
        ) : null}

        {onDelete ? (
          <button
            type="button"
            className="address__delete"
            onClick={() => onDelete(address)}
            disabled={busy}
          >
            Delete
          </button>
        ) : null}
      </div>
    </li>
  );
}
