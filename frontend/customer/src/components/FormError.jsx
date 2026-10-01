/**
 * The failure that is not about one input — wrong password, server down, offline.
 *
 * `role="alert"` so it is announced the moment it appears: a customer who has
 * just pressed a button and is waiting needs to be told it did not work, and a
 * silently-appearing red box does not do that for a screen reader.
 */
export function FormError({ error }) {
  if (!error) return null;

  return (
    <p className="notice notice--danger" role="alert">
      {error.message ?? 'Something went wrong. Please try again.'}
    </p>
  );
}

/** The counterpart: something worked. Polite, because it is not urgent. */
export function FormSuccess({ children }) {
  if (!children) return null;

  return (
    <p className="notice notice--success" role="status">
      {children}
    </p>
  );
}
