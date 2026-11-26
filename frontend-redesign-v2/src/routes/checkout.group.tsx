import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bike, Check, Loader2, MapPin, ShoppingBag, Tag, X } from "lucide-react";
import { endpoints } from "@/lib/cpse/endpoints";
import { cpse, useAllCarts } from "@/customer/hooks";
import { RequireAuth } from "@/customer/RequireAuth";
import { AddressForm } from "@/customer/components/AddressForm";
import { formatPaise } from "@/lib/cpse/money";
import { ErrorState, InlineError, Skel } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/checkout/group")({
  head: () => ({ meta: [{ title: "Multi-shop checkout — CPSE" }, { name: "description", content: "Choose how each shop fulfils your order and pay once." }] }),
  component: () => <RequireAuth><GroupCheckout /></RequireAuth>,
});

function GroupCheckout() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const cartsQuery = useAllCarts();
  const addresses = useQuery({ queryKey: ["addresses"], queryFn: cpse<{ addresses: any[] }>(() => endpoints.addresses.list()) });
  const preferences = useQuery({ queryKey: ["preferences"], queryFn: cpse<{ preferences: any }>(() => endpoints.preferences.get()) });
  const carts = cartsQuery.data?.carts ?? [];
  const [modes, setModes] = useState<Record<string, "pickup" | "delivery">>({});
  const [addressId, setAddressId] = useState("");
  const [addingAddress, setAddingAddress] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("online");
  const [note, setNote] = useState("");
  const [substitution, setSubstitution] = useState("contact_me");
  const [couponDrafts, setCouponDrafts] = useState<Record<string, string>>({});
  const [couponCodes, setCouponCodes] = useState<Record<string, string>>({});
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<any>(null);
  const idempotencyKey = useMemo(() => globalThis.crypto?.randomUUID?.() ?? `cpse-${Date.now()}-${Math.random()}`, []);

  useEffect(() => {
    if (!carts.length) return;
    setModes((current) => {
      const next = { ...current };
      for (const entry of carts) if (!next[entry.cart.storeId]) {
        next[entry.cart.storeId] = entry.store.fulfilment.pickupEnabled ? "pickup" : "delivery";
      }
      return next;
    });
  }, [carts]);
  useEffect(() => {
    const list = addresses.data?.addresses ?? [];
    if (!addressId && list.length) setAddressId((list.find((item: any) => item.isDefault) ?? list[0]).id);
  }, [addresses.data, addressId]);
  useEffect(() => {
    const value = preferences.data?.preferences?.preferredSubstitution;
    if (value) setSubstitution(value);
  }, [preferences.data]);

  const selections = carts.map(({ cart }: any) => ({ storeId: cart.storeId, fulfilmentMode: modes[cart.storeId], ...(couponCodes[cart.storeId] ? { couponCode: couponCodes[cart.storeId] } : {}) }));
  const needsAddress = selections.some((shop: any) => shop.fulfilmentMode === "delivery");
  const readyToQuote = carts.length > 1 && selections.every((shop: any) => Boolean(shop.fulfilmentMode)) && (!needsAddress || Boolean(addressId));
  const quote = useQuery({
    queryKey: ["quote", "group", selections, needsAddress ? addressId : null],
    queryFn: cpse<{ quote: any }>(() => endpoints.checkout.groupQuote({ shops: selections, ...(needsAddress ? { addressId } : {}) })),
    enabled: readyToQuote,
  });
  const q = quote.data?.quote;
  useEffect(() => {
    if (q?.paymentMethods?.length && !q.paymentMethods.some((method: any) => method.code === paymentMethod)) setPaymentMethod(q.paymentMethods[0].code);
  }, [q, paymentMethod]);

  const saveAddress = async (payload: Record<string, string>) => {
    const { data } = await endpoints.addresses.create(payload);
    await client.invalidateQueries({ queryKey: ["addresses"] });
    setAddressId(data.address.id);
    setAddingAddress(false);
  };

  const place = async () => {
    if (placing || !q?.canPlaceOrder) return;
    setPlacing(true);
    setError(null);
    try {
      const { data } = await endpoints.orders.createGroup({
        shops: q.shops.map((shop: any) => ({ storeId: shop.storeId, fulfilmentMode: shop.fulfilmentMode, expectedTotalPaise: shop.totals.totalPaise, ...(couponCodes[shop.storeId] ? { couponCode: couponCodes[shop.storeId] } : {}) })),
        ...(needsAddress ? { addressId } : {}), paymentMethod,
        ...(note.trim() ? { customerNote: note.trim() } : {}),
        ...(substitution ? { substitutionPreference: substitution } : {}),
        expectedTotalPaise: q.totals.totalPaise,
      }, idempotencyKey);
      await client.invalidateQueries({ queryKey: ["cart"] });
      await client.invalidateQueries({ queryKey: ["orders"] });
      const group = data.group;
      if (paymentMethod === "online") await navigate({ to: "/payment/$orderId", params: { orderId: group.orders[0].id }, replace: true });
      else await navigate({ to: "/orders", replace: true });
    } catch (cause: any) {
      setError(cause);
      if (cause?.code === "TOTAL_CHANGED") await quote.refetch();
    } finally { setPlacing(false); }
  };

  if (cartsQuery.isLoading) return <div role="status" aria-label="Loading checkout" className="mx-auto max-w-3xl space-y-4"><Skel className="h-20 rounded-2xl" /><Skel className="h-56 rounded-2xl" /><Skel className="h-40 rounded-2xl" /></div>;
  if (cartsQuery.error) return <ErrorState error={cartsQuery.error} onRetry={() => cartsQuery.refetch()} />;
  if (carts.length < 2) return <div className="mx-auto max-w-xl"><Link to="/cart" className="inline-flex items-center gap-2 text-sm font-semibold"><ArrowLeft className="h-4 w-4" /> Back to cart</Link><div className="surface mt-5 p-6">Multi-shop checkout needs items from at least two shops. <Link to="/cart" className="underline">Review your cart</Link></div></div>;

  const addressList = addresses.data?.addresses ?? [];
  return <div className="mx-auto max-w-5xl">
    <Link to="/cart" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to cart</Link>
    <header className="mb-5"><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-strong">One checkout · {carts.length} shops</p><h1 className="text-3xl font-extrabold sm:text-4xl">Review your orders</h1><p className="mt-1 text-sm text-muted-foreground">Each shop receives its own order. Pay once for everything.</p></header>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="space-y-4">
        {carts.map(({ cart, store }: any) => <section key={cart.storeId} className="surface p-4 sm:p-5">
          <header className="mb-3 flex items-start justify-between gap-3"><div><h2 className="font-bold">{cart.storeName}</h2><p className="text-xs text-muted-foreground">{cart.totals.totalQuantity} {cart.totals.totalQuantity === 1 ? "item" : "items"}</p></div><span className="numeric font-bold">{formatPaise(cart.totals.totalPaise)}</span></header>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label={`Fulfilment for ${cart.storeName}`}>
            {(["pickup", "delivery"] as const).map((mode) => {
              const enabled = mode === "pickup" ? store.fulfilment.pickupEnabled : store.fulfilment.deliveryEnabled;
              const selected = modes[cart.storeId] === mode;
              return <button type="button" key={mode} disabled={!enabled} aria-pressed={selected} onClick={() => setModes((current) => ({ ...current, [cart.storeId]: mode }))} className={cn("flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors", selected ? "border-primary bg-primary-soft/50" : "border-border bg-card hover:border-border-strong/50", !enabled && "cursor-not-allowed opacity-40")}>
                {mode === "pickup" ? <ShoppingBag className="h-4 w-4" /> : <Bike className="h-4 w-4" />}{mode === "pickup" ? "Pickup" : "Delivery"}{selected ? <Check className="h-4 w-4" /> : null}
              </button>;
            })}
          </div>
          {couponCodes[cart.storeId] ? <p className="mt-3 flex items-center justify-between rounded-xl bg-success-soft px-3 py-2 text-sm"><span className="flex items-center gap-2"><Tag className="h-4 w-4 text-success" /> Coupon <strong>{couponCodes[cart.storeId]}</strong></span><button type="button" onClick={() => setCouponCodes((current) => { const next = { ...current }; delete next[cart.storeId]; return next; })} aria-label={`Remove ${cart.storeName} coupon`} className="rounded-full p-1 hover:bg-card"><X className="h-4 w-4" /></button></p> : <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); const code = couponDrafts[cart.storeId]?.trim().toUpperCase(); if (code) setCouponCodes((current) => ({ ...current, [cart.storeId]: code })); }}><input value={couponDrafts[cart.storeId] ?? ""} onChange={(event) => setCouponDrafts((current) => ({ ...current, [cart.storeId]: event.target.value }))} placeholder={`Coupon for ${cart.storeName}`} aria-label={`Coupon code for ${cart.storeName}`} className="h-10 min-w-0 flex-1 rounded-full border border-input bg-paper px-4 text-sm uppercase outline-none focus:border-border-strong" /><Button type="submit" variant="outline" size="sm" className="h-10">Apply</Button></form>}
          {q?.shops?.find((item: any) => item.storeId === cart.storeId)?.warnings?.map((warning: any, index: number) => <p key={index} className="mt-2 text-xs text-muted-foreground">{warning.message}</p>)}
        </section>)}

        {needsAddress ? <section className="surface p-4 sm:p-5"><h2 className="mb-3 flex items-center gap-2 font-bold"><MapPin className="h-4 w-4" /> Delivery address</h2>
          {addingAddress ? <AddressForm submitLabel="Save and use address" onSubmit={saveAddress} onCancel={() => setAddingAddress(false)} /> : <div className="space-y-3">
            {addressList.length ? <div className="grid gap-2">{addressList.map((address: any) => <label key={address.id} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3", addressId === address.id ? "border-primary bg-primary-soft/40" : "border-border")}><input type="radio" name="group-address" checked={addressId === address.id} onChange={() => setAddressId(address.id)} /><span className="min-w-0"><span className="block font-semibold">{address.label || address.recipientName}</span><span className="block text-sm text-muted-foreground">{address.line1}, {address.city} · {address.postalCode}</span></span></label>)}</div> : <p className="text-sm text-muted-foreground">Add an address to deliver the selected shop orders.</p>}
            <Button type="button" variant="outline" onClick={() => setAddingAddress(true)}>{addressList.length ? "Add another address" : "Add delivery address"}</Button>
          </div>}
        </section> : null}

        <section className="surface p-4 sm:p-5"><h2 className="mb-3 font-bold">One payment for all shops</h2>{q?.paymentMethods?.length ? <div className="rounded-xl border border-primary bg-primary-soft/40 p-3"><p className="font-semibold">Pay once online</p><p className="text-xs text-muted-foreground">One charge covers the orders from every shop.</p></div> : <div className="text-sm text-muted-foreground">{quote.isFetching ? "Checking whether every shop accepts online payment…" : q?.paymentBlockers?.length ? <><p>Turn on online payment for these shops to pay once:</p><ul className="mt-2 list-disc space-y-1 pl-5 font-semibold text-foreground">{q.paymentBlockers.map((shop: any) => <li key={shop.storeId}>{shop.storeName}</li>)}</ul></> : "A combined checkout is available when every selected shop accepts online payment. You can still checkout each shop separately."}</div>}
          <label className="mt-4 block text-sm font-semibold" htmlFor="group-note">Note for each shop <span className="font-normal text-muted-foreground">(optional)</span></label><textarea id="group-note" maxLength={500} rows={2} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" placeholder="Anything the shops should know?" />
          <label className="mt-4 block text-sm font-semibold" htmlFor="group-substitution">If an item is unavailable</label><select id="group-substitution" value={substitution} onChange={(event) => setSubstitution(event.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"><option value="contact_me">Ask me before replacing anything</option><option value="allow_similar">Replace with a similar item</option><option value="no_substitutions">Leave unavailable items out</option></select>
        </section>
      </div>

      <aside className="lg:sticky lg:top-28"><div className="surface p-5"><h2 className="text-lg font-bold">Combined total</h2>{q?.totals ? <div className="mt-4 space-y-2 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Items</span><span>{formatPaise(q.totals.subtotalPaise)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Discounts</span><span>−{formatPaise(q.totals.discountPaise)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Delivery</span><span>{formatPaise(q.totals.deliveryFeePaise)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{formatPaise(q.totals.taxPaise)}</span></div><div className="flex justify-between border-t border-dashed pt-3 text-base font-extrabold"><span>Total · one payment</span><span className="numeric">{formatPaise(q.totals.totalPaise)}</span></div></div> : <p className="mt-3 text-sm text-muted-foreground">Choose pickup or delivery for each shop to see your total.</p>}
          {q?.blockers?.length ? <ul className="mt-3 space-y-1 text-xs text-destructive">{q.blockers.map((item: any, index: number) => <li key={index}>{item.storeName}: {item.message}</li>)}</ul> : null}
          <InlineError error={error} className="mt-3" />
          <Button size="lg" className="mt-5 w-full" disabled={!q?.canPlaceOrder || !q?.paymentMethods?.some((method: any) => method.code === paymentMethod) || placing || addingAddress} onClick={() => void place()}>{placing ? <Loader2 className="animate-spin" /> : null}{placing ? "Placing shop orders…" : paymentMethod === "online" ? `Pay ${formatPaise(q?.totals?.totalPaise ?? 0)} once` : "Place shop orders"}</Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">Each shop prepares, fulfils and tracks its own order.</p>
        </div></aside>
    </div>
  </div>;
}
