import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { messagingApi } from '../../api/ops';
import { errorMessage } from '../../api/client';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { ErrorState, NoStore, PageHeader, Spinner, formatDateTime } from '../../components/common/ui';
import './Tools.css';

/**
 * Store announcements (roadmap §5 P5): a short note to people who saved the
 * shop and agreed to hear from it. The server picks the recipients from
 * consent, so this form cannot reach anyone who opted out.
 */
export default function AnnouncementsPage() {
  const { activeStoreId } = useActiveStore();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const query = useQuery({ queryKey: ['announcements', activeStoreId], queryFn: () => messagingApi.announcements(activeStoreId!), enabled: !!activeStoreId });
  const send = useMutation({
    mutationFn: () => messagingApi.announce(activeStoreId!, { title: title.trim(), ...(body.trim() ? { body: body.trim() } : {}) }),
    onSuccess: () => { setTitle(''); setBody(''); queryClient.invalidateQueries({ queryKey: ['announcements', activeStoreId] }); showToast('Announcement sent', 'success'); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  if (!activeStoreId) return <NoStore title="Announcements" />;
  const audience = query.data?.audience;

  return (
    <div className="stack">
      <PageHeader title="Announcements" subtitle="New stock, holiday hours, a festival offer — tell the people who follow your shop." />
      <form className="card form-grid" onSubmit={(e) => { e.preventDefault(); if (window.confirm(`Send to ${audience?.optedIn ?? 0} customers?`)) send.mutate(); }}>
        <p className="tiny" style={{ margin: 0 }}>{audience ? `${audience.followers} people saved your shop; ${audience.optedIn} agreed to hear about offers and will get this.` : 'Counting your followers…'}</p>
        <div className="input-wrapper"><label className="input-label" htmlFor="an-title">Headline</label>
          <input id="an-title" className="input-field" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fresh mangoes are in" /></div>
        <div className="input-wrapper"><label className="input-label" htmlFor="an-body">Details (optional)</label>
          <textarea id="an-body" className="input-field" rows={3} maxLength={500} value={body} onChange={(e) => setBody(e.target.value)} /></div>
        <button type="submit" className="btn btn-primary" disabled={send.isPending || !title.trim() || !audience?.optedIn}>{send.isPending ? 'Sending…' : 'Send announcement'}</button>
      </form>
      <section className="card">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Sent</h2>
        {query.isLoading ? <Spinner /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : (query.data?.announcements ?? []).length === 0 ? <p className="muted">Nothing sent yet.</p> : (
          <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
            {query.data!.announcements.map((a) => (
              <li key={a.id}><strong>{a.title}</strong>{a.body ? <div>{a.body}</div> : null}<div className="tiny">{formatDateTime(a.sentAt)} · {a.recipientCount} recipients</div></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
