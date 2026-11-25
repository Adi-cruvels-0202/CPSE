import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { storeApi } from '../../api/endpoints';
import { whatsappApi, type WhatsappLinking, type WhatsappStatus } from '../../api/ops';
import { errorMessage } from '../../api/client';
import { useToast } from '../../hooks/useToast';
import { ErrorState, PageHeader, Spinner } from '../../components/common/ui';
import { IconCheck, IconCopy, IconExternalLink } from '../../components/icons/Icons';
import './Tools.css';

/**
 * Run the shop from WhatsApp: link one number, then check orders, accept and
 * move them on, see sales and stock, add received stock and close for the
 * day by messaging the CPSE business number. Linking proves the number is
 * the owner's: the code shown here has to be sent from that number.
 */

/** 919876543210 → "+91 98765 43210"; other countries just get a "+". */
export const prettyPhone = (digits: string) =>
  digits.length === 12 && digits.startsWith('91') ? `+91 ${digits.slice(2, 7)} ${digits.slice(7)}` : `+${digits}`;

const COMMANDS: [string, string][] = [
  ['orders', 'Open orders, tap one to act on it'],
  ['order 7UWQ4T', 'One order, with Accept / Ready / Done buttons'],
  ['accept 7UWQ4T · ready 7UWQ4T · done 7UWQ4T', 'Move an order on'],
  ['reject 7UWQ4T · cancel 7UWQ4T out of stock', 'Asks first, then tells the customer'],
  ['missing 7UWQ4T', "An item you can't pack: the rest of the order goes ahead"],
  ['sales · sales yesterday · sales week', 'Online orders and counter sales'],
  ['stock rice · low stock', "What's left, and what's running out"],
  ['add 10 rice', 'Stock received (asks which product first)'],
  ['close today · open today', 'Show the shop as closed for today, or reopen'],
  ['shop', 'Switch shop, if you have more than one'],
];

export default function WhatsAppPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [phone, setPhone] = useState('');
  const [linking, setLinking] = useState<WhatsappLinking | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const status = useQuery({
    queryKey: ['whatsapp'],
    queryFn: () => whatsappApi.status(),
    // While a code is waiting to be sent, notice the moment it arrives.
    refetchInterval: (q) => (q.state.data?.whatsapp.link?.status === 'pending' ? 4000 : false),
  });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => storeApi.list() });

  if (status.isLoading) return <Spinner large />;
  if (status.error || !status.data) return <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  const wa: WhatsappStatus = status.data.whatsapp;
  const link = wa.link;
  const set = (next: WhatsappStatus) => queryClient.setQueryData(['whatsapp'], { whatsapp: next });

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { linking: started } = await whatsappApi.link(phone || link?.phone || '');
      setLinking(started);
      set(started.status);
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = async (body: { notifyOrders?: boolean; activeStoreId?: string }) => {
    try {
      set((await whatsappApi.update(body)).whatsapp);
      showToast('Saved', 'success');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  };

  const unlink = async () => {
    setBusy(true);
    try {
      set((await whatsappApi.unlink()).whatsapp);
      setLinking(null);
      setConfirmUnlink(false);
      showToast('WhatsApp unlinked', 'success');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); showToast('Copied', 'success'); }
    catch { showToast('Copy did not work. Select the text and copy it.', 'error'); }
  };

  return (
    <div className="whatsapp-page">
      <PageHeader title="WhatsApp" subtitle="Run your shop by sending a message: orders, sales, stock and new-order alerts." />

      {!wa.configured && (
        <div className="alert-strip alert-strip-warning" role="status">
          WhatsApp isn't switched on for CPSE yet. You can link your number now; messages start working once the CPSE team connects the business number.
        </div>
      )}

      {link?.status === 'active' ? (
        <section className="card whatsapp-card" aria-labelledby="wa-linked">
          <div className="whatsapp-linked">
            <span className="whatsapp-linked__icon" aria-hidden="true"><IconCheck size={20} /></span>
            <div>
              <h2 id="wa-linked" className="whatsapp-card__title">Linked to {prettyPhone(link.phone)}</h2>
              <p className="tiny">
                Message {wa.businessNumber ? prettyPhone(wa.businessNumber) : 'the CPSE number'} from this number to manage your shop.
              </p>
            </div>
          </div>
          {wa.chatLink && (
            <a className="btn btn-primary" href={wa.chatLink} target="_blank" rel="noreferrer"><IconExternalLink size={16} /> Open WhatsApp</a>
          )}

          <label className="switch whatsapp-switch">
            <input type="checkbox" className="switch-input" checked={link.notifyOrders} onChange={(e) => save({ notifyOrders: e.target.checked })} />
            <span className="switch-slider" />
            <span>Send me new orders on WhatsApp, with Accept and Reject buttons</span>
          </label>

          {(stores.data?.stores.length ?? 0) > 1 && (
            <div className="input-wrapper whatsapp-store">
              <label className="input-label" htmlFor="wa-store">Messages are about</label>
              <select id="wa-store" className="input-field select-field" value={link.activeStoreId ?? ''} onChange={(e) => save({ activeStoreId: e.target.value })}>
                {stores.data!.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <p className="tiny">You can also send <strong>shop</strong> on WhatsApp to switch.</p>
            </div>
          )}

          <div className="whatsapp-unlink">
            {confirmUnlink ? (
              <>
                <span className="tiny">This number will stop managing your shop.</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmUnlink(false)} disabled={busy}>Keep it</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={unlink} disabled={busy}>Yes, unlink</button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmUnlink(true)}>Unlink this number</button>
            )}
          </div>
        </section>
      ) : (
        <section className="card whatsapp-card" aria-labelledby="wa-link">
          <h2 id="wa-link" className="whatsapp-card__title">Link your WhatsApp number</h2>
          <ol className="whatsapp-steps">
            <li>Enter the WhatsApp number you'll use for the shop.</li>
            <li>Send the code we show you from that number. That proves it's yours.</li>
            <li>That's it. Send <strong>hi</strong> any time to see what you can do.</li>
          </ol>

          <form className="whatsapp-form" onSubmit={start}>
            <div className="input-wrapper">
              <label className="input-label" htmlFor="wa-phone">WhatsApp number</label>
              <input id="wa-phone" className="input-field" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210"
                value={phone} onChange={(e) => setPhone(e.target.value)} required={!link} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy || (!phone.trim() && !link)}>
              {busy ? 'Getting a code…' : link ? 'Get a new code' : 'Get my code'}
            </button>
          </form>

          {(linking || link?.status === 'pending') && (
            <div className="whatsapp-code" role="status">
              {linking ? (
                <>
                  <p>From <strong>{prettyPhone(linking.phone)}</strong>, send this message to {wa.businessNumber ? <strong>{prettyPhone(wa.businessNumber)}</strong> : 'the CPSE number'}:</p>
                  <p className="whatsapp-code__message mono">{linking.message}</p>
                  <div className="whatsapp-code__actions">
                    {linking.chatLink && (
                      <a className="btn btn-primary" href={linking.chatLink} target="_blank" rel="noreferrer"><IconExternalLink size={16} /> Open WhatsApp with this message</a>
                    )}
                    <button type="button" className="btn btn-secondary" onClick={() => copy(linking.message)}><IconCopy size={16} /> Copy</button>
                  </div>
                  <p className="tiny">The code works for 15 minutes. This page updates by itself once it arrives.</p>
                </>
              ) : (
                <p className="tiny">Waiting for the code from {prettyPhone(link!.phone)}. Lost it? Press "Get a new code".</p>
              )}
            </div>
          )}
        </section>
      )}

      <section className="card whatsapp-card" aria-labelledby="wa-commands">
        <h2 id="wa-commands" className="whatsapp-card__title">What you can send</h2>
        <p className="tiny">Order codes are the last part of the order number, e.g. 7UWQ4T for CPSE-261114-7UWQ4T. Most of the time you'll just tap the buttons.</p>
        <dl className="whatsapp-commands">
          {COMMANDS.map(([cmd, what]) => (
            <div key={cmd}><dt className="mono">{cmd}</dt><dd>{what}</dd></div>
          ))}
        </dl>
      </section>
    </div>
  );
}
