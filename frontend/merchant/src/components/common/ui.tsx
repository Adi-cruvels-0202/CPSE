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
