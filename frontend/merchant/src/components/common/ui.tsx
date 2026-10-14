import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Meta } from '../../api/client';
import type { OrderStatus } from '../../api/types';
import { IconStore } from '../icons/Icons';

/** Small shared pieces, so every screen says "loading" and "empty" the same way. */

export function Spinner({ large = false }: { large?: boolean }) {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div className={`spinner ${large ? 'spinner-lg' : ''}`} role="status" aria-label="Loading" />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-title">{title}</div>
      {description && <div className="empty-state-description">{description}</div>}
      {action}
    </div>
  );
}

/** For a page that needs a store when the merchant has none yet. */
export function NoStore({ title }: { title: string }) {
  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">{title}</h1></div></div>
      <EmptyState
        icon={<IconStore size={32} />}
        title="No store yet"
        description="Create your store first — everything else hangs off it."
        action={<Link to="/store/new" className="btn btn-primary">Create a store</Link>}
      />
    </div>
  );
}

/** The API's pages are 1-based. */
export function Pagination({ meta, onPage }: { meta?: Meta; onPage: (page: number) => void }) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="pagination">
      <button className="btn btn-secondary btn-sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</button>
      <span className="pagination-info">Page {meta.page} of {meta.totalPages}</span>
      <button className="btn btn-secondary btn-sm" disabled={!meta.hasNextPage} onClick={() => onPage(meta.page + 1)}>Next</button>
    </div>
  );
}

const STATUS_BADGE: Record<OrderStatus, string> = {
  pending_payment: 'badge-neutral',
  placed: 'badge-warning',
  accepted: 'badge-info',
  preparing: 'badge-info',
  ready_for_pickup: 'badge-success',
  out_for_delivery: 'badge-success',
  completed: 'badge-neutral',
  cancelled: 'badge-danger',
  rejected: 'badge-danger',
};

export function OrderStatusBadge({ status, label }: { status: OrderStatus; label: string }) {
  return <span className={`badge ${STATUS_BADGE[status] ?? 'badge-neutral'}`}>{label}</span>;
}

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export const titleCase = (value: string) => value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** A request that failed: what went wrong, and a way to try again. */
export function ErrorState({ error, onRetry, title = 'That did not load' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  return (
    <div className="alert-strip alert-strip-danger" role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
      <span><strong>{title}.</strong> {message}</span>
      {onRetry && <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

/** The standard dialog frame. `busy` stops it closing mid-save. */
export function Modal({ title, onClose, children, footer, size, busy = false }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'lg'; busy?: boolean;
}) {
  return (
    <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={`dialog-content${size === 'lg' ? ' dialog-lg' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-header"><h2 className="dialog-title">{title}</h2></div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-footer">{footer ?? <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>}</div>
      </div>
    </div>
  );
}

/** Underlined section tabs inside a page. */
export function SubTabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="tabs" role="tablist" style={{ marginBottom: 'var(--space-4)', overflowX: 'auto' }}>
      {options.map((option) => (
        <button key={option.value} type="button" role="tab" aria-selected={value === option.value}
          className={`tab${value === option.value ? ' tab-active' : ''}`} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—';

/** A fresh key for an idempotent write (one per form submission, reused on retry). */
export const newIdempotencyKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
