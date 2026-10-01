/**
 * The whole-screen wait. Announced politely, so a screen reader says what is
 * happening instead of falling silent.
 */
export function FullPageSpinner({ label = 'Loading' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-3)',
        minHeight: '60vh',
        color: 'var(--text-muted)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <div className="spinner" />
      <span>{label}…</span>
    </div>
  );
}
