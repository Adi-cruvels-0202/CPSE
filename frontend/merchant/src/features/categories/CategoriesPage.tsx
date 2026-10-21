import { useState, type DragEvent, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { categoryApi, storeApi } from '../../api/endpoints';
import { catalogueOpsApi } from '../../api/ops';
import { errorMessage } from '../../api/client';
import type { Category } from '../../api/types';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { EmptyState, Modal, NoStore, Spinner } from '../../components/common/ui';
import { IconTag, IconPlus, IconEdit, IconEye, IconTrash } from '../../components/icons/Icons';
import './Categories.css';

/**
 * Categories, in the order customers see them. Drag a row (or use ↑ ↓) to
 * change that order. A store starts with the usual categories for its kind of
 * shop; any of those it does not have yet are offered here again. Deleting asks where the products go — another category, or
 * none — so nothing is ever uncategorised silently; hiding is the gentler
 * option, and its products still show under "all".
 */
export default function CategoriesPage() {
  const { activeStoreId } = useActiveStore();
  const storeQuery = useQuery({ queryKey: ['store', activeStoreId], queryFn: () => storeApi.get(activeStoreId!), enabled: !!activeStoreId });
  const shopCategory = storeQuery.data?.store.shopCategory ?? null;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [moving, setMoving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['categories', activeStoreId],
    queryFn: () => categoryApi.list(activeStoreId!),
    enabled: !!activeStoreId,
  });
  const categories = data?.categories ?? [];

  if (!activeStoreId) return <NoStore title="Categories" />;

  const reload = () => queryClient.invalidateQueries({ queryKey: ['categories', activeStoreId] });

  const toggle = async (category: Category) => {
    try {
      if (category.isActive) await categoryApi.deactivate(activeStoreId, category.id);
      else await categoryApi.activate(activeStoreId, category.id);
      showToast(category.isActive ? `${category.name} hidden from customers` : `${category.name} visible again`, 'info');
      reload();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  };

  const saveOrder = async (order: string[]) => {
    setMoving(true);
    try {
      await catalogueOpsApi.reorderCategories(activeStoreId, order);
      await reload();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setMoving(false);
    }
  };

  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= categories.length) return;
    const order = categories.map((c) => c.id);
    [order[index], order[target]] = [order[target], order[index]];
    void saveOrder(order);
  };

  /** Drag a row onto another: it takes that place and the rest shift. */
  const drop = (event: DragEvent, to: number) => {
    event.preventDefault();
    const from = dragFrom;
    setDragFrom(null);
    setDragOver(null);
    if (from === null || from === to) return;
    const order = categories.map((c) => c.id);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    void saveOrder(order);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Categories</h1>
          <p className="page-subtitle">{categories.length} {categories.length === 1 ? 'category' : 'categories'}{categories.length > 1 ? ' · drag a row (or use the arrows) to change the order customers see' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><IconPlus size={16} /> Add category</button>
      </div>

      {!isLoading && !storeQuery.isLoading && (
        <StarterCategories
          storeId={activeStoreId}
          shopCategory={shopCategory}
          existing={categories.map((c) => c.name.toLowerCase())}
          prominent={categories.length === 0}
          onAdded={reload}
        />
      )}

      {isLoading ? <Spinner large /> : categories.length === 0 ? (
        <EmptyState
          icon={<IconTag size={32} />}
          title="No categories yet"
          description="Categories group your products on the store page — Staples, Snacks, Dairy."
          action={<button className="btn btn-primary" onClick={() => setEditing('new')}>Create a category</button>}
        />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead><tr><th style={{ width: 132 }}>Order</th><th>Name</th><th>Description</th><th>Products</th><th>Status</th><th style={{ width: 150 }}></th></tr></thead>
            <tbody>
              {categories.map((category, index) => (
                <tr
                  key={category.id}
                  draggable={!moving}
                  onDragStart={(event) => { setDragFrom(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', category.id); }}
                  onDragOver={(event) => { event.preventDefault(); if (dragOver !== index) setDragOver(index); }}
                  onDragLeave={() => setDragOver((current) => (current === index ? null : current))}
                  onDrop={(event) => drop(event, index)}
                  onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
                  className={`category-row${dragFrom === index ? ' is-dragging' : ''}${dragOver === index && dragFrom !== null && dragFrom !== index ? ' is-drop-target' : ''}`}
                >
                  <td style={{ color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                    <span className="drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
                    {index + 1}
                    <button className="btn btn-ghost btn-sm" disabled={moving || index === 0} onClick={() => move(index, -1)} aria-label={`Move ${category.name} up`}>↑</button>
                    <button className="btn btn-ghost btn-sm" disabled={moving || index === categories.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${category.name} down`}>↓</button>
                  </td>
                  <td style={{ fontWeight: 'var(--font-semibold)' }}>{category.name}</td>
                  <td style={{ color: 'var(--color-text-secondary)', maxWidth: 300 }}><span className="truncate" style={{ display: 'block' }}>{category.description || '—'}</span></td>
                  <td>{category.productCount}</td>
                  <td><span className={`badge ${category.isActive ? 'badge-success' : 'badge-neutral'}`}>{category.isActive ? 'Visible' : 'Hidden'}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(category)} aria-label={`Edit ${category.name}`}><IconEdit size={14} /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggle(category)} aria-label={category.isActive ? 'Hide' : 'Show'} title={category.isActive ? 'Hide from customers' : 'Show to customers'}><IconEye size={14} /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(category)} aria-label={`Delete ${category.name}`} title="Delete"><IconTrash size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CategoryModal
          storeId={activeStoreId}
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      {deleting && (
        <DeleteCategoryModal
          storeId={activeStoreId}
          category={deleting}
          others={categories.filter((c) => c.id !== deleting.id)}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); reload(); queryClient.invalidateQueries({ queryKey: ['products'] }); }}
        />
      )}
    </div>
  );
}

const SHOP_LABELS: Record<string, string> = {
  grocery: 'grocery / kirana', bakery: 'bakery', restaurant: 'restaurant', pharmacy: 'pharmacy', clothing: 'clothing',
  electronics: 'electronics', stationery: 'stationery', general: 'general',
};

/**
 * The usual categories for this kind of shop (the industry templates), so a
 * new owner ticks and adds rather than typing each one. Only the ones the store
 * does not have yet; nothing is added until "Add". A store of type "other"
 * picks which kind of shop to start from.
 */
function StarterCategories({ storeId, shopCategory, existing, prominent, onAdded }: {
  storeId: string; shopCategory: string | null; existing: string[]; prominent: boolean; onAdded: () => void;
}) {
  const { showToast } = useToast();
  const [chosenIndustry, setChosenIndustry] = useState<string | null>(null);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const summaries = useQuery({ queryKey: ['templates'], queryFn: () => catalogueOpsApi.templates(), staleTime: Infinity });
  const known = summaries.data?.templates ?? [];
  const industry = chosenIndustry ?? (known.some((t) => t.industry === shopCategory) ? shopCategory : null);
  const template = useQuery({
    queryKey: ['template', industry],
    queryFn: () => catalogueOpsApi.template(industry!),
    enabled: !!industry,
    staleTime: Infinity,
  });
  const missing = (template.data?.template.categories ?? []).filter((name) => !existing.includes(name.toLowerCase()));
  const picked = missing.filter((name) => !unticked.has(name));

  if (summaries.isLoading || (industry && template.isLoading)) return null;
  if (industry && missing.length === 0) return null;
  if (!prominent && !open) {
    return (
      <p className="starter-link">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
          <IconPlus size={14} /> Add starter categories{industry ? ` for a ${SHOP_LABELS[industry] ?? industry} shop` : ''}
        </button>
      </p>
    );
  }

  const add = async () => {
    setAdding(true);
    try {
      const { report } = await catalogueOpsApi.applyTemplate(storeId, { industry, applyDefaults: false, categories: picked, products: [] });
      showToast(`${report.categoriesCreated.length} ${report.categoriesCreated.length === 1 ? 'category' : 'categories'} added.`, 'success');
      setUnticked(new Set());
      setOpen(false);
      onAdded();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="starter-panel card" aria-labelledby="starter-title">
      <div className="starter-panel__head">
        <h2 id="starter-title" className="starter-panel__title">
          {industry ? `Start with the usual categories for a ${SHOP_LABELS[industry] ?? industry} shop` : 'Start with the usual categories for your kind of shop'}
        </h2>
        <p className="starter-panel__hint">Untick any you don't need. You can rename, reorder or delete them later, then add products into each.</p>
      </div>
      <div className="input-wrapper starter-panel__type">
        <label className="input-label" htmlFor="starter-type">Kind of shop</label>
        <select id="starter-type" className="input-field" value={industry ?? ''} onChange={(e) => { setChosenIndustry(e.target.value || null); setUnticked(new Set()); }}>
          {!industry && <option value="">Choose…</option>}
          {known.map((t) => <option key={t.industry} value={t.industry}>{t.label}</option>)}
        </select>
      </div>
      {industry && (
        <div className="starter-panel__chips" role="group" aria-label="Starter categories">
          {missing.map((name) => {
            const on = !unticked.has(name);
            return (
              <label key={name} className={`starter-chip${on ? ' is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => {
                  const next = new Set(unticked);
                  if (on) next.add(name); else next.delete(name);
                  setUnticked(next);
                }} />
                {name}
              </label>
            );
          })}
        </div>
      )}
      <div className="starter-panel__actions">
        {!prominent && <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Not now</button>}
        <button type="button" className="btn btn-primary" disabled={!industry || picked.length === 0 || adding} onClick={add}>
          {adding ? 'Adding…' : `Add ${picked.length} ${picked.length === 1 ? 'category' : 'categories'}`}
        </button>
      </div>
    </section>
  );
}

function DeleteCategoryModal({ storeId, category, others, onClose, onDeleted }: {
  storeId: string; category: Category; others: Category[]; onClose: () => void; onDeleted: () => void;
}) {
  const { showToast } = useToast();
  const [target, setTarget] = useState(others[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const hasProducts = category.productCount > 0;

  const remove = async () => {
    setBusy(true);
    try {
      const body = !hasProducts ? {} : target ? { moveToCategoryId: target } : { uncategorise: true };
      const { movedProducts } = await catalogueOpsApi.deleteCategory(storeId, category.id, body);
      showToast(movedProducts ? `${category.name} deleted; ${movedProducts} products moved.` : `${category.name} deleted.`, 'success');
      onDeleted();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Delete ${category.name}?`} onClose={onClose} busy={busy}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button>
      </>}>
      {hasProducts ? (
        <div className="input-wrapper">
          <label className="input-label" htmlFor="cat-move">It has {category.productCount} products. Move them to</label>
          <select id="cat-move" className="input-field" value={target} onChange={(e) => setTarget(e.target.value)}>
            {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="">No category</option>
          </select>
        </div>
      ) : <p>It has no products. This cannot be undone.</p>}
    </Modal>
  );
}

function CategoryModal({ storeId, category, onClose, onSaved }: { storeId: string; category: Category | null; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const body = { name: name.trim(), description: description.trim() || null };
      if (category) await categoryApi.update(storeId, category.id, body);
      else await categoryApi.create(storeId, body);
      showToast(category ? 'Category saved' : 'Category created', 'success');
      onSaved();
    } catch (err) {
      showToast(errorMessage(err, 'Could not save the category.'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-content" role="dialog" aria-modal="true" aria-labelledby="category-title">
        <div className="dialog-header"><h2 className="dialog-title" id="category-title">{category ? 'Edit category' : 'New category'}</h2></div>
        <form onSubmit={handleSubmit}>
          <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="input-wrapper">
              <label className="input-label" htmlFor="cat-name">Name *</label>
              <input id="cat-name" className="input-field" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fruits & Vegetables" autoFocus />
            </div>
            <div className="input-wrapper">
              <label className="input-label" htmlFor="cat-description">Description</label>
              <textarea id="cat-description" className="input-field textarea-field" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="dialog-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? 'Saving…' : category ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
