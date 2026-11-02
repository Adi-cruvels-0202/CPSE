import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { FormError } from '../../components/FormError.jsx';
import { Sheet } from '../../components/Sheet.jsx';
import { ProductRow } from '../engage/ProductRow.jsx';
import '../engage/Engage.css';

/**
 * The shop assistant (roadmap §5 P6, Phase E): questions about this shop in
 * plain words — hours, delivery, offers, sizes and prices, "my usual" — and a
 * whole shopping list typed or spoken in one go. It answers from the shop's
 * live data and only ever proposes: every item goes into the cart through the
 * normal cart rules, and nothing is ordered without checkout (C-74).
 */

const SpeechRecognition = () => (typeof window === 'undefined' ? null : window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null);

/** A microphone where the browser can listen; nothing where it cannot. */
export function SpeakButton({ onText }) {
  const Ctor = SpeechRecognition();
  const [listening, setListening] = useState(false);
  if (!Ctor) return null;
  const start = () => {
    const recognition = new Ctor();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.onresult = (event) => onText(event.results[0][0].transcript);
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  };
  return (
    <button type="button" className="btn btn--secondary btn--sm" onClick={start} disabled={listening} aria-label="Speak">
      {listening ? 'Listening…' : '🎤'}
    </button>
  );
}

export function ShopAssistant({ store, isSignedIn }) {
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const input = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  const ask = useSubmit(async () => {
    const { data } = await endpoints.intelligence.assistant(store.slug, message.trim());
    setReply(data.reply);
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="store-assistant-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="store-assistant-trigger__icon" aria-hidden="true"><ChatIcon /></span>
        <span className="store-assistant-trigger__copy">
          <strong>Ask {store.name}</strong>
          <span>Products, prices or store hours</span>
        </span>
        <span className="store-assistant-trigger__arrow" aria-hidden="true">›</span>
      </button>

      <Sheet
        open={open}
        title={`Ask ${store.name}`}
        onClose={close}
        returnFocusTarget={triggerRef.current}
      >
        <div className="stack store-assistant" style={{ gap: 'var(--space-3)' }}>
          <p className="muted store-assistant__intro">Ask about products, prices, availability or opening hours.</p>
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (message.trim()) ask.submit();
            }}
          >
            <input
              ref={input}
              className="field__input"
              aria-label="Ask the shop assistant"
              placeholder="e.g. Do you have basmati rice?"
              maxLength={500}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <SpeakButton onText={(text) => { setMessage(text); input.current?.focus(); }} />
            <button type="submit" className="btn btn--sm" disabled={ask.pending || !message.trim()}>{ask.pending ? '…' : 'Ask'}</button>
          </form>
          <FormError error={ask.error} />
          {reply ? <Reply reply={reply} store={store} isSignedIn={isSignedIn} /> : null}
        </div>
      </Sheet>
    </>
  );
}

function ChatIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20 11.5Z" />
      <path d="M8 11h.01M12 11h.01M16 11h.01" />
    </svg>
  );
}

function Reply({ reply, store, isSignedIn }) {
  const lines = reply.proposals ?? reply.results ?? [];
  return (
    <div className="stack" role="status" style={{ gap: 'var(--space-2)' }} data-testid="assistant-reply">
      {reply.answer ? <p style={{ margin: 0 }}>{reply.answer}</p> : null}
      {reply.kind === 'sign_in' ? <Link to="/login" state={{ from: `/store/${store.slug}` }} className="btn btn--secondary btn--sm">Sign in</Link> : null}
      {reply.unmatched?.length ? <p className="muted">Not found here: {reply.unmatched.map((u) => u.text).join(', ')}.</p> : null}
      {lines.length ? (
        isSignedIn ? (
          <>
            <ul className="prows">
              {lines.slice(0, 10).map((line, index) => (
                <ProductRow
                  key={`${line.product.id}-${index}`}
                  product={line.product}
                  variantId={line.add?.variantId ?? line.suggestion?.variantId}
                  quantity={line.add?.quantity ?? 1}
                  detail={[line.suggestion?.variantName, line.text ? `for “${line.text}”` : null, line.reason].filter(Boolean).join(' · ')}
                />
              ))}
            </ul>
            {lines.length > 1 && reply.intent !== 'search' && reply.intent !== 'compare' ? <AddAll lines={lines} storeId={store.id} /> : null}
          </>
        ) : (
          <p className="muted">
            <Link to="/login" state={{ from: `/store/${store.slug}` }}>Sign in</Link> to add these to your cart.
          </p>
        )
      ) : null}
      {reply.source ? <p className="field__hint">From: {reply.source}</p> : null}
    </div>
  );
}

/** Adds every proposed line, one at a time through the cart, and says what did not go in. */
function AddAll({ lines, storeId }) {
  const [result, setResult] = useState(null);
  const add = useSubmit(async () => {
    const added = [];
    const failed = [];
    for (const line of lines) {
      try {
        await endpoints.cart.addItem(line.add);
        added.push(line.product.name);
      } catch (caught) {
        failed.push(`${line.product.name} (${caught.message})`);
      }
    }
    setResult({ added, failed });
  });
  if (result) {
    return (
      <p className={`notice notice--${result.failed.length ? 'warning' : 'success'}`}>
        Added {result.added.length} to your cart.{result.failed.length ? ` Not added: ${result.failed.join('; ')}.` : ''}{' '}
        <Link to={`/cart/${storeId}`}>Go to cart</Link>
      </p>
    );
  }
  return (
    <button type="button" className="btn btn--sm" onClick={() => add.submit()} disabled={add.pending}>
      {add.pending ? 'Adding…' : `Add all ${lines.length} to cart`}
    </button>
  );
}

/** New-to-you products from the categories this customer buys here (§5 P6). */
export function DiscoverHere({ storeId }) {
  const query = useApiQuery(() => endpoints.intelligence.discover(storeId), [storeId]);
  const discover = query.data?.discover;
  if (!discover || discover.items.length === 0) return null;
  return (
    <section className="stack" aria-labelledby="discover-heading" style={{ gap: 'var(--space-2)' }}>
      <h2 id="discover-heading" className="engage__title">{discover.basedOn === 'your_categories' ? 'New for you here' : 'Popular here'}</h2>
      <ul className="prows">
        {discover.items.slice(0, 4).map((item) => (
          <ProductRow key={item.product.id} product={item.product} detail={item.reason} />
        ))}
      </ul>
    </section>
  );
}

/** Bought together, and similar products — on the product page. */
export function ProductSuggestions({ slug, productId, purchasable }) {
  const together = useApiQuery(() => endpoints.intelligence.recommendations(slug, productId), [slug, productId]);
  const similar = useApiQuery(() => endpoints.intelligence.alternatives(slug, productId), [slug, productId]);
  const bought = together.data?.recommendations?.items ?? [];
  const alike = similar.data?.alternatives?.items ?? [];
  if (bought.length === 0 && alike.length === 0) return null;
  const boughtIds = new Set(bought.map((item) => item.product.id));
  const combined = [...bought, ...alike.filter((item) => !boughtIds.has(item.product.id))];
  const Section = ({ title, items, id }) => (
    <section className="stack" aria-labelledby={id} style={{ gap: 'var(--space-2)' }}>
      <h2 id={id} className="engage__title">{title}</h2>
      <ul className="prows">
        {items.slice(0, 4).map((item) => (
          <ProductRow key={item.product.id} product={item.product} detail={item.reason} />
        ))}
      </ul>
    </section>
  );
  return (
    <>
      {!purchasable && alike.length ? <Section id="similar-heading" title="Instead, try" items={alike} /> : null}
      {purchasable && combined.length ? <Section id="suggestions-heading" title="You may also like" items={combined} /> : null}
    </>
  );
}

