import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import { storeApi } from '../../api/endpoints';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { ErrorState, NoStore, PageHeader, Spinner } from '../../components/common/ui';
import { IconCopy, IconExternalLink, IconShare } from '../../components/icons/Icons';
import './Tools.css';

/**
 * Share the shop (roadmap §4 P1 discoverability): the public link, a QR code
 * for the counter (download or print), WhatsApp and the map location. The
 * customer app is served from the same origin as this one, at /store/<slug>.
 */
export const storeLink = (slug: string, origin = window.location.origin) => `${origin}/store/${encodeURIComponent(slug)}`;

export default function SharePage() {
  const { activeStoreId } = useActiveStore();
  const { showToast } = useToast();
  const canvasHolder = useRef<HTMLDivElement>(null);
  const query = useQuery({ queryKey: ['store', activeStoreId], queryFn: () => storeApi.get(activeStoreId!), enabled: !!activeStoreId });
  if (!activeStoreId) return <NoStore title="Share your shop" />;
  if (query.isLoading) return <Spinner large />;
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const store = query.data.store;
  const url = storeLink(store.slug);
  const message = `Order from ${store.name} online: ${url}`;
  const mapUrl = store.latitude !== null && store.longitude !== null ? `https://www.google.com/maps/search/?api=1&query=${store.latitude},${store.longitude}` : null;

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); showToast('Link copied', 'success'); }
    catch { showToast('Copy did not work — select the link and copy it.', 'error'); }
  };
  const nativeShare = async () => {
    try { await navigator.share({ title: store.name, text: `Order from ${store.name}`, url }); } catch { /* cancelled */ }
  };
  const downloadQr = () => {
    const canvas = canvasHolder.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${store.slug}-qr.png`;
    a.click();
  };

  return (
    <div className="stack">
      <div className="no-print">
        <PageHeader title="Share your shop" subtitle="Put the QR code at the counter and send the link to regulars." />
      </div>
      {!store.isPublished && <div className="alert-strip alert-strip-warning no-print">Your shop is not published yet, so customers who open this link will not find it.</div>}

      <section className="card no-print">
        <label className="input-label" htmlFor="share-url">Your shop's link</label>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <input id="share-url" className="input-field mono" readOnly value={url} style={{ flex: 1, minWidth: 220 }} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn-secondary" onClick={copy}><IconCopy size={16} /> Copy</button>
          <a className="btn btn-secondary" href={url} target="_blank" rel="noreferrer"><IconExternalLink size={16} /> Open</a>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
          <a className="btn btn-primary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
          {typeof navigator !== 'undefined' && 'share' in navigator && <button type="button" className="btn btn-secondary" onClick={nativeShare}><IconShare size={16} /> Share…</button>}
          {mapUrl ? <a className="btn btn-secondary" href={mapUrl} target="_blank" rel="noreferrer">Show on map</a> : <span className="tiny">Add your location in Store settings to share a map pin.</span>}
        </div>
      </section>

      <section className="card" style={{ textAlign: 'center' }}>
        <h2 className="print-only" style={{ fontSize: '28px' }}>{store.name}</h2>
        <div className="qr-box" ref={canvasHolder}>
          <QRCodeCanvas value={url} size={240} marginSize={2} level="M" title={`QR code for ${store.name}`} />
        </div>
        <p style={{ marginTop: 'var(--space-3)' }}><strong>Scan to order from {store.name}</strong></p>
        <p className="tiny mono">{url}</p>
        <div className="no-print" style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
          <button type="button" className="btn btn-secondary" onClick={downloadQr}>Download QR</button>
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}>Print poster</button>
        </div>
      </section>
    </div>
  );
}
