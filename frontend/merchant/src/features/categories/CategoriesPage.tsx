import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { categoryApi } from '../../api/endpoints';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { IconTag, IconPlus, IconEdit, IconEye } from '../../components/icons/Icons';
import './Categories.css';

export default function CategoriesPage() {
  const { activeStoreId } = useActiveStore();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any>(null);

  const { data: catRes, isLoading } = useQuery({
    queryKey: ['categories', activeStoreId],
    queryFn: () => categoryApi.list(activeStoreId!),
    enabled: !!activeStoreId,
  });

  const categories = catRes?.data?.data || [];

  if (!activeStoreId) {
    return (
      <div>
        <div className="page-header"><div><h1 className="page-title">Categories</h1></div></div>
        <div className="empty-state">
          <div className="empty-state-icon"><IconTag size={32} /></div>
          <div className="empty-state-title">No store selected</div>
          <div className="empty-state-description">Create a store first in Store Setup.</div>
          <a href="/store/setup" className="btn btn-primary">Go to Store Setup</a>
        </div>
      </div>
    );
  }

  const handleToggleActive = async (cat: any) => {
    try {
      if (cat.active) {
        await categoryApi.deactivate(activeStoreId, cat.id);
        showToast(`${cat.name} deactivated`, 'info');
      } else {
        await categoryApi.activate(activeStoreId, cat.id);
        showToast(`${cat.name} activated`, 'success');
      }
      queryClient.invalidateQueries({ queryKey: ['categories', activeStoreId] });
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || 'Failed to update category', 'error');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Categories</h1>
          <p className="page-subtitle">{categories.length} {categories.length === 1 ? 'category' : 'categories'}</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditingCategory(null); setShowModal(true); }}>
          <IconPlus size={16} />
          Add Category
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-lg" /></div>
      ) : categories.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><IconTag size={32} /></div>
          <div className="empty-state-title">No categories yet</div>
          <div className="empty-state-description">Categories help organize your products. Create your first one to get started.</div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>Create Category</button>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>#</th>
                <th>Name</th>
                <th>Description</th>
                <th>Status</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat: any, i: number) => (
                <tr key={cat.id}>
                  <td style={{ color: 'var(--color-text-tertiary)' }}>{i + 1}</td>
                  <td><span style={{ fontWeight: 'var(--font-semibold)' }}>{cat.name}</span></td>
                  <td style={{ color: 'var(--color-text-secondary)', maxWidth: 300 }}>
                    <span className="truncate" style={{ display: 'block' }}>{cat.description || '—'}</span>
                  </td>
                  <td>
                    <span className={`badge ${cat.active ? 'badge-success' : 'badge-neutral'}`}>
                      {cat.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditingCategory(cat); setShowModal(true); }}><IconEdit size={14} /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleToggleActive(cat)}><IconEye size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <CategoryModal
          storeId={activeStoreId}
          category={editingCategory}
          onClose={() => { setShowModal(false); setEditingCategory(null); }}
          onSuccess={() => { setShowModal(false); setEditingCategory(null); queryClient.invalidateQueries({ queryKey: ['categories', activeStoreId] }); }}
        />
      )}
    </div>
  );
}

function CategoryModal({ storeId, category, onClose, onSuccess }: {
  storeId: string; category: any; onClose: () => void; onSuccess: () => void;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState(category?.name || '');
  const [description, setDescription] = useState(category?.description || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (category) { await categoryApi.update(storeId, category.id, { name, description }); showToast('Category updated', 'success'); }
      else { await categoryApi.create(storeId, { name, description }); showToast('Category created', 'success'); }
      onSuccess();
    } catch (err: any) { showToast(err.response?.data?.error?.message || 'Failed to save category', 'error'); }
    finally { setIsSaving(false); }
  };

  return (
    <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-content">
        <div className="dialog-header"><h2 className="dialog-title">{category ? 'Edit Category' : 'New Category'}</h2></div>
        <form onSubmit={handleSubmit}>
          <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="input-wrapper">
              <label className="input-label">Name *</label>
              <input className="input-field" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fruits & Vegetables" autoFocus />
            </div>
            <div className="input-wrapper">
              <label className="input-label">Description</label>
              <textarea className="input-field textarea-field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
            </div>
          </div>
          <div className="dialog-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? 'Saving...' : category ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
