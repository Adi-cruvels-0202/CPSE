import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { categoryApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import type { Category } from '../../api/types';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { EmptyState, NoStore, Spinner } from '../../components/common/ui';
import { IconTag, IconPlus, IconEdit, IconEye } from '../../components/icons/Icons';
import './Categories.css';

/**
 * Categories, in the order customers see them. There is no delete: removing a
 * category would quietly uncategorise its products. Hide it instead — its
 * products still show under "all".
 */
export default function CategoriesPage() {
  const { activeStoreId } = useActiveStore();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);

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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Categories</h1>
          <p className="page-subtitle">{categories.length} {categories.length === 1 ? 'category' : 'categories'}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><IconPlus size={16} /> Add category</button>
      </div>

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
            <thead><tr><th style={{ width: 60 }}>#</th><th>Name</th><th>Description</th><th>Products</th><th>Status</th><th style={{ width: 120 }}></th></tr></thead>
            <tbody>
              {categories.map((category, index) => (
                <tr key={category.id}>
                  <td style={{ color: 'var(--color-text-tertiary)' }}>{index + 1}</td>
                  <td style={{ fontWeight: 'var(--font-semibold)' }}>{category.name}</td>
                  <td style={{ color: 'var(--color-text-secondary)', maxWidth: 300 }}><span className="truncate" style={{ display: 'block' }}>{category.description || '—'}</span></td>
                  <td>{category.productCount}</td>
                  <td><span className={`badge ${category.isActive ? 'badge-success' : 'badge-neutral'}`}>{category.isActive ? 'Visible' : 'Hidden'}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(category)} aria-label={`Edit ${category.name}`}><IconEdit size={14} /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggle(category)} aria-label={category.isActive ? 'Hide' : 'Show'} title={category.isActive ? 'Hide from customers' : 'Show to customers'}><IconEye size={14} /></button>
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
    </div>
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
