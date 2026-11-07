import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bike, ShoppingBag, MapPin, Plus, Wallet, CreditCard, BookOpenText, AlertTriangle, Info, Loader2, Lock, Check, Tag, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { ApiError } from "@/lib/cpse/api";
import { formatPaise } from "@/lib/cpse/money";
import { RequireAuth } from "@/customer/RequireAuth";
import { cpse, useCart } from "@/customer/hooks";
import { AddressForm } from "@/customer/components/AddressForm";
import { ErrorState, InlineError, Skel, EmptyState } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/checkout/$storeId")({
  head: () => ({
    meta: [
      { title: "Checkout — CPSE" },
      { name: "description", content: "Choose pickup or delivery, how to pay, and place your order." },
      { property: "og:title", content: "Checkout — CPSE" },
      { property: "og:description", content: "Choose pickup or delivery and place your order." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <CheckoutPage />
    </RequireAuth>
  ),
});

const SUBSTITUTION_PREFERENCE: Record<string, string> = {
  contact_me: "Ask me before replacing anything",
  allow_similar: "Replace with a similar item if needed",
  no_substitutions: "No replacements — leave it out",
};

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className="surface p-5 sm:p-6" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="mb-4 flex items-center gap-3 text-lg font-bold">
        <span className={cn("numeric grid h-7 w-7 place-items-center rounded-full text-sm", done ? "bg-success text-success-foreground" : "bg-ink text-ink-foreground")}>
          {done ? <Check className="h-4 w-4" /> : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Choice({ checked, onChange, name, value, icon, title, detail, disabled }: { checked: boolean; onChange: () => void; name: string; value: string; icon: React.ReactNode; title: string; detail?: React.ReactNode; disabled?: boolean }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-colors",
        checked ? "border-border-strong bg-primary-soft/50" : "border-border bg-paper hover:border-border-strong/40",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} className="sr-only" />
      <span className="mt-0.5 [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        {detail ? <span className="block text-sm text-muted-foreground">{detail}</span> : null}
      </span>
      <span className={cn("mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2", checked ? "border-ink bg-ink" : "border-input")} aria-hidden="true">
        {checked ? <span className="h-2 w-2 rounded-full bg-ink-foreground" /> : null}
      </span>
    </label>
  );
}

function CheckoutPage() {
  const { storeId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cart = useCart(storeId);
  const storeSlug = cart.data?.cart?.storeSlug;

  const store = useQuery({ queryKey: ["store", storeSlug], queryFn: cpse<{ store: any }>(() => endpoints.stores.get(storeSlug)), enabled: Boolean(storeSlug) });
  const addresses = useQuery({ queryKey: ["addresses"], queryFn: cpse<{ addresses: any[] }>(() => endpoints.addresses.list()) });
  const methods = useQuery({ queryKey: ["payment-methods"], queryFn: cpse<{ methods: any[] }>(() => endpoints.payments.methods()) });
  const khata = useQuery({ queryKey: ["khata"], queryFn: cpse<{ accounts: any[] }>(() => endpoints.khata.list()) });
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: cpse<{ preferences: any }>(() => endpoints.preferences.get()) });

  const [mode, setMode] = useState<"pickup" | "delivery" | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [substitution, setSubstitution] = useState<string | null>(null);
  const [couponDraft, setCouponDraft] = useState("");
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<any>(null);
  const idempotencyKey = useMemo(() => globalThis.crypto?.randomUUID?.() ?? `cpse-${Date.now()}-${Math.random()}`, []);

  const fulfilment = store.data?.store?.fulfilment;
  const accepts = store.data?.store?.payment;

  useEffect(() => {
    if (mode || !fulfilment) return;
    if (fulfilment.pickupEnabled) setMode("pickup");
    else if (fulfilment.deliveryEnabled) setMode("delivery");
  }, [fulfilment, mode]);

  useEffect(() => {
    const list = addresses.data?.addresses ?? [];
    if (addressId || !list.length) return;
    setAddressId((list.find((a: any) => a.isDefault) ?? list[0]).id);
  }, [addresses.data, addressId]);

  useEffect(() => {
    if (substitution === null && prefs.data?.preferences?.preferredSubstitution) setSubstitution(prefs.data.preferences.preferredSubstitution);
  }, [prefs.data, substitution]);

  const khataAccount = (khata.data?.accounts ?? []).find((a: any) => a.storeId === storeId && a.isActive);
  const offered = useMemo(() => {
    const list = (methods.data?.methods ?? []).filter((m: any) => {
      if (!accepts) return true;
      if (m.code === "online") return accepts.online;
      if (m.code === "cash") return accepts.cashOnDelivery;
      return true;
    });
    if (accepts?.khata && khataAccount?.availableCreditPaise != null && !list.some((m: any) => m.code === "khata")) {
      list.push({ code: "khata", label: "Add to my khata", description: `Pay the shop later. ${formatPaise(khataAccount.availableCreditPaise)} of credit available.` });
    }
    return list;
  }, [methods.data, accepts, khataAccount]);

  useEffect(() => {
    if (offered.length && !offered.some((m: any) => m.code === paymentMethod)) setPaymentMethod(offered[0].code);
  }, [offered, paymentMethod]);

  const needsAddress = mode === "delivery";
  const canQuote = Boolean(mode) && (!needsAddress || Boolean(addressId));
  const quote = useQuery({
    queryKey: ["quote", storeId, mode, needsAddress ? addressId : null, couponCode],
    queryFn: cpse<{ quote: any }>(() =>
      endpoints.checkout.quote({ storeId, fulfilmentMode: mode, ...(needsAddress && addressId ? { addressId } : {}), ...(couponCode ? { couponCode } : {}) }),
    ),
    enabled: canQuote,
    placeholderData: (prev) => prev,
  });
  const q = quote.data?.quote;

  const place = async () => {
    if (placing || !q?.canPlaceOrder) return;
    setPlacing(true);
    setPlaceError(null);
    try {
      const { data } = await endpoints.orders.create(
        {
          storeId,
          fulfilmentMode: mode,
          ...(needsAddress ? { addressId } : {}),
          paymentMethod,
          ...(note.trim() ? { customerNote: note.trim() } : {}),
          ...(couponCode ? { couponCode } : {}),
          ...(substitution ? { substitutionPreference: substitution } : {}),
          expectedTotalPaise: q.totals.totalPaise,
        },
        idempotencyKey,
      );
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      const order = data.order;
      if (paymentMethod === "online") navigate({ to: "/payment/$orderId", params: { orderId: order.id }, replace: true });
      else navigate({ to: "/orders/$orderId", params: { orderId: order.id }, search: { placed: true }, replace: true });
    } catch (e: any) {
      setPlaceError(e);
      if (e instanceof ApiError && !(e as any).isTransient) quote.refetch();
    } finally {
      setPlacing(false);
    }
  };

  if (cart.isLoading) {
    return (
      <div role="status" aria-label="Loading checkout" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-4">{[0, 1, 2].map((k) => <Skel key={k} className="h-40 rounded-2xl" />)}</div>
        <Skel className="h-80 rounded-2xl" />
      </div>
    );
  }
  if (cart.error) return <ErrorState error={cart.error} onRetry={() => cart.refetch()} />;
  if (!cart.data?.cart?.lines?.length) {
    return (
      <EmptyState title="Nothing to check out" body="This cart is empty — the order may already have been placed.">
        <Button asChild variant="ink"><Link to="/orders">See my orders</Link></Button>
      </EmptyState>
    );
  }

  const c = cart.data.cart;
  const addrList = addresses.data?.addresses ?? [];

  return (
    <div>
      <Link to="/cart/$storeId" params={{ storeId }} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to cart
      </Link>
      <h1 className="mb-6 text-3xl font-extrabold sm:text-4xl">Checkout <span className="text-muted-foreground">· {c.storeName}</span></h1>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-4">
          <Step n={1} title="How do you want it?" done={Boolean(mode) && (!needsAddress || Boolean(addressId))}>
            <div role="radiogroup" aria-label="Pickup or delivery" className="grid gap-3 sm:grid-cols-2">
              <Choice name="mode" value="pickup" checked={mode === "pickup"} onChange={() => setMode("pickup")} disabled={fulfilment ? !fulfilment.pickupEnabled : false} icon={<ShoppingBag />} title="Pickup" detail="Collect from the shop. No fee." />
              <Choice
                name="mode"
                value="delivery"
                checked={mode === "delivery"}
                onChange={() => setMode("delivery")}
                disabled={fulfilment ? !fulfilment.deliveryEnabled : false}
                icon={<Bike />}
                title="Delivery"
                detail={fulfilment?.deliveryEnabled ? (fulfilment.deliveryFeePaise > 0 ? `${formatPaise(fulfilment.deliveryFeePaise)} delivery fee` : "Free delivery") : "This shop doesn’t deliver"}
              />
            </div>

            {needsAddress ? (
              <div className="mt-5">
                <h3 className="mb-3 text-sm font-bold">Deliver to</h3>
                {addresses.isLoading ? <Skel className="h-20 rounded-xl" /> : null}
                {addrList.length > 0 && !adding ? (
                  <div role="radiogroup" aria-label="Delivery address" className="grid gap-3">
                    {addrList.map((a: any) => (
                      <Choice
                        key={a.id}
                        name="address"
                        value={a.id}
                        checked={addressId === a.id}
                        onChange={() => setAddressId(a.id)}
                        icon={<MapPin />}
                        title={`${a.label ? `${a.label} · ` : ""}${a.recipientName}`}
                        detail={[a.line1, a.line2, a.city, a.postalCode].filter(Boolean).join(", ")}
                      />
                    ))}
                    <Button variant="outline" className="justify-self-start" onClick={() => setAdding(true)}>
                      <Plus /> Add another address
                    </Button>
                  </div>
                ) : null}
                {(addrList.length === 0 && !addresses.isLoading) || adding ? (
                  <div className="rounded-xl border border-dashed bg-paper p-4">
                    <AddressForm
                      submitLabel="Use this address"
                      onCancel={addrList.length ? () => setAdding(false) : undefined}
                      onSubmit={async (payload) => {
                        const { data } = await endpoints.addresses.create(payload);
                        await queryClient.invalidateQueries({ queryKey: ["addresses"] });
                        setAddressId(data.address.id);
                        setAdding(false);
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </Step>

          <Step n={2} title="How will you pay?" done={Boolean(paymentMethod)}>
            <div role="radiogroup" aria-label="Payment method" className="grid gap-3">
              {offered.map((m: any) => (
                <Choice
                  key={m.code}
                  name="payment"
                  value={m.code}
                  checked={paymentMethod === m.code}
                  onChange={() => setPaymentMethod(m.code)}
                  icon={m.code === "online" ? <CreditCard /> : m.code === "khata" ? <BookOpenText /> : <Wallet />}
                  title={m.label}
                  detail={m.description}
                />
              ))}
              {methods.isLoading ? <Skel className="h-16 rounded-xl" /> : null}
            </div>
          </Step>

          <Step n={3} title="Anything the shop should know?">
            <fieldset>
              <legend className="mb-2 text-sm font-bold">If something is out of stock</legend>
              <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
                {Object.entries(SUBSTITUTION_PREFERENCE).map(([code, label]) => (
                  <label key={code} className={cn("flex cursor-pointer items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm", (substitution ?? "contact_me") === code ? "border-border-strong bg-primary-soft/50 font-semibold" : "border-border bg-paper")}>
                    <input type="radio" name="substitution" value={code} checked={(substitution ?? "contact_me") === code} onChange={() => setSubstitution(code)} className="accent-[var(--ink)]" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-bold">Note for the shop (optional)</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="Ring the bell twice, pack separately…" className="w-full rounded-xl border border-input bg-paper px-4 py-3 outline-none focus:border-border-strong" />
            </label>
          </Step>
        </div>

        <aside aria-label="Order total" className="lg:sticky lg:top-28 lg:self-start">
          <div className="surface overflow-hidden">
            <div className="awning h-2 text-primary" aria-hidden="true" />
            <div className="p-5">
              <h2 className="mb-3 text-lg font-bold">Your order</h2>
              <ul className="mb-4 max-h-56 space-y-2 overflow-y-auto text-sm">
                {(q?.lines ?? c.lines).map((l: any) => (
                  <li key={l.id} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">
                      <span className="numeric font-semibold">{l.quantity}×</span> {l.name}
                      {l.variantName ? <span className="text-muted-foreground"> · {l.variantName}</span> : null}
                    </span>
                    <span className="numeric shrink-0">{formatPaise(l.lineTotalPaise)}</span>
                  </li>
                ))}
              </ul>

              <div className="mb-4">
                {couponCode ? (
                  <p className="flex items-center justify-between rounded-xl bg-success-soft px-3 py-2 text-sm">
                    <span className="flex items-center gap-2"><Tag className="h-4 w-4 text-success" /> Coupon <strong>{couponCode}</strong></span>
                    <button type="button" onClick={() => setCouponCode(null)} aria-label="Remove coupon" className="rounded-full p-1 hover:bg-card"><X className="h-4 w-4" /></button>
                  </p>
                ) : (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (couponDraft.trim()) setCouponCode(couponDraft.trim().toUpperCase());
                    }}
                  >
                    <input value={couponDraft} onChange={(e) => setCouponDraft(e.target.value)} placeholder="Coupon code" aria-label="Coupon code" className="h-10 min-w-0 flex-1 rounded-full border border-input bg-paper px-4 text-sm uppercase outline-none focus:border-border-strong" />
                    <Button type="submit" variant="outline" size="sm" className="h-10">Apply</Button>
                  </form>
                )}
              </div>

              {!canQuote ? (
                <p className="rounded-xl bg-muted px-3 py-3 text-sm text-muted-foreground">Choose pickup or delivery{needsAddress ? " and an address" : ""} to see your total.</p>
              ) : quote.isLoading ? (
                <Skel className="h-32 rounded-xl" />
              ) : quote.error && !q ? (
                <InlineError error={quote.error} />
              ) : q ? (
                <div aria-live="polite" className={cn(quote.isFetching && "opacity-60 transition-opacity")}>
                  <dl className="space-y-1.5 text-sm">
                    <Row label="Items" value={formatPaise(q.totals.subtotalPaise)} />
                    {q.totals.discountPaise > 0 ? <Row label="Savings" value={`−${formatPaise(q.totals.discountPaise)}`} success /> : null}
                    {mode === "delivery" ? <Row label="Delivery" value={q.totals.deliveryFeePaise > 0 ? formatPaise(q.totals.deliveryFeePaise) : "Free"} /> : null}
                    <Row label="GST" value={formatPaise(q.totals.taxPaise)} />
                  </dl>
                  {q.freeDelivery && !q.freeDelivery.isUnlocked ? (
                    <p className="mt-3 rounded-lg bg-info-soft px-3 py-2 text-xs">
                      Add <strong className="numeric">{formatPaise(q.freeDelivery.remainingPaise)}</strong> more for free delivery.
                    </p>
                  ) : null}
                  <div className="mt-4 flex items-baseline justify-between border-t border-dashed pt-4">
                    <span className="font-bold">To pay</span>
                    <span className="numeric font-display text-3xl font-extrabold">{formatPaise(q.totals.totalPaise)}</span>
                  </div>
                  {(q.blockers ?? []).length ? (
                    <ul className="mt-3 space-y-1.5" role="alert">
                      {q.blockers.map((b: any, i: number) => (
                        <li key={i} className="flex gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {b.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {(q.warnings ?? []).length ? (
                    <ul className="mt-3 space-y-1.5" role="status">
                      {q.warnings.map((w: any, i: number) => (
                        <li key={i} className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm">
                          <Info className="mt-0.5 h-4 w-4 shrink-0" /> {w.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              <InlineError error={placeError} className="mt-3" />
              <Button size="xl" className="mt-4 w-full" onClick={place} disabled={placing || !q?.canPlaceOrder || quote.isFetching}>
                {placing ? <Loader2 className="animate-spin" /> : <Lock />}
                {placing ? "Placing order…" : paymentMethod === "online" ? "Place order & pay" : "Place order"}
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">You’ll only be charged the total shown here.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, success }: { label: string; value: string; success?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("numeric font-semibold", success && "text-success")}>{value}</dd>
    </div>
  );
}
