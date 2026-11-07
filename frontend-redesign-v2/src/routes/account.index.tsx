import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPinned, ReceiptText, Heart, Bell, BookOpenText, LogOut, ChevronRight, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { useAuth } from "@/customer/auth";
import { RequireAuth } from "@/customer/RequireAuth";
import { cpse } from "@/customer/hooks";
import { Field } from "@/components/cpse/Field";
import { InlineError, PageTitle, Skel } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/account/")({
  head: () => ({
    meta: [
      { title: "Your account — CPSE" },
      { name: "description", content: "Update your details and shopping preferences on CPSE." },
      { property: "og:title", content: "Your account — CPSE" },
      { property: "og:description", content: "Update your details and shopping preferences." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <AccountPage />
    </RequireAuth>
  ),
});

function AccountPage() {
  const { customer, setCustomer, signOut } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState(customer?.fullName ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<any>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      if (fullName.trim() !== (customer?.fullName ?? "")) payload.fullName = fullName.trim();
      if (phone.trim() !== (customer?.phone ?? "")) payload.phone = phone.trim() || null;
      if (Object.keys(payload).length) {
        const { data } = await endpoints.profile.update(payload);
        setCustomer(data.customer);
      }
      toast.success("Details saved");
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const links = [
    { to: "/orders", label: "Orders", icon: ReceiptText },
    { to: "/saved", label: "Favourite shops", icon: Heart },
    { to: "/account/addresses", label: "Addresses", icon: MapPinned },
    { to: "/notifications", label: "Notifications", icon: Bell },
    { to: "/khata", label: "Khata", icon: BookOpenText },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle eyebrow="Account" title={customer?.fullName ?? "Your account"} body={customer?.email} />
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <nav aria-label="Account" className="surface h-fit p-2">
          <ul>
            {links.map((l) => (
              <li key={l.to}>
                <Link to={l.to as any} className="flex min-h-12 items-center gap-3 rounded-xl px-3 font-semibold hover:bg-accent">
                  <l.icon className="h-5 w-5 text-muted-foreground" />
                  <span className="flex-1">{l.label}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
            <li className="mt-1 border-t border-dashed pt-1">
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  navigate({ to: "/" });
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 font-semibold text-destructive hover:bg-destructive-soft"
              >
                <LogOut className="h-5 w-5" /> Sign out
              </button>
            </li>
          </ul>
        </nav>

        <div className="space-y-6">
          <section className="surface p-5 sm:p-6" aria-labelledby="details-h">
            <h2 id="details-h" className="mb-4 text-lg font-bold">Your details</h2>
            <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" error={error?.fieldErrors?.fullName} />
              <Field label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" error={error?.fieldErrors?.phone} />
              <Field className="sm:col-span-2" label="Email" value={customer?.email ?? ""} disabled hint="Your email can’t be changed here." />
              {error && !Object.keys(error?.fieldErrors ?? {}).length ? <InlineError error={error} className="sm:col-span-2" /> : null}
              <div className="sm:col-span-2">
                <Button type="submit" variant="ink" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : null} Save details</Button>
              </div>
            </form>
          </section>
          <Preferences />
        </div>
      </div>
    </div>
  );
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-bold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, text]) => (
          <label key={v} className={cn("flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold", value === v ? "border-ink bg-ink text-ink-foreground" : "border-border bg-paper hover:border-border-strong")}>
            <input type="radio" className="sr-only" checked={value === v} onChange={() => onChange(v)} />
            {value === v ? <Check className="h-3.5 w-3.5" /> : null}
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Preferences() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["preferences"], queryFn: cpse<{ preferences: any }>(() => endpoints.preferences.get()) });
  const [form, setForm] = useState<any>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    if (query.data?.preferences && !form) setForm(query.data.preferences);
  }, [query.data, form]);

  if (query.isLoading || !form) return <Skel className="h-72 rounded-2xl" />;
  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const { data } = await endpoints.preferences.update({
        preferredFulfilment: form.preferredFulfilment,
        preferredPaymentMethod: form.preferredPaymentMethod,
        preferredSubstitution: form.preferredSubstitution,
        activityTracking: form.activityTracking,
        occasionOffers: form.occasionOffers,
        birthday: form.birthday?.month && form.birthday?.day ? { month: Number(form.birthday.month), day: Number(form.birthday.day) } : null,
      });
      queryClient.setQueryData(["preferences"], { preferences: data.preferences });
      setForm(data.preferences);
      toast.success("Preferences saved");
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="surface space-y-5 p-5 sm:p-6" aria-labelledby="prefs-h">
      <div>
        <h2 id="prefs-h" className="text-lg font-bold">How you like to shop</h2>
        <p className="text-sm text-muted-foreground">Checkout starts with these. You can still change them per order.</p>
      </div>
      <Segmented label="Pickup or delivery" value={form.preferredFulfilment ?? ""} onChange={(v) => set({ preferredFulfilment: v || null })} options={[["", "No preference"], ["pickup", "Pickup"], ["delivery", "Delivery"]]} />
      <Segmented label="Paying" value={form.preferredPaymentMethod ?? ""} onChange={(v) => set({ preferredPaymentMethod: v || null })} options={[["", "No preference"], ["cash", "Cash"], ["online", "Online"]]} />
      <Segmented
        label="If something is out of stock"
        value={form.preferredSubstitution ?? "contact_me"}
        onChange={(v) => set({ preferredSubstitution: v })}
        options={[["contact_me", "Ask me first"], ["allow_similar", "Similar item is fine"], ["no_substitutions", "Leave it out"]]}
      />
      <div className="space-y-3 border-t border-dashed pt-4">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block font-semibold">Remember what I look at</span>
            <span className="text-sm text-muted-foreground">Powers “recently viewed” and “buy again”. Turning it off deletes your viewing history.</span>
          </span>
          <Switch checked={Boolean(form.activityTracking)} onCheckedChange={(v) => set({ activityTracking: v })} aria-label="Remember what I look at" />
        </label>
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block font-semibold">Birthday and occasion offers</span>
            <span className="text-sm text-muted-foreground">Shops can send you an offer on special days.</span>
          </span>
          <Switch checked={Boolean(form.occasionOffers)} onCheckedChange={(v) => set({ occasionOffers: v })} aria-label="Birthday and occasion offers" />
        </label>
      </div>
      <InlineError error={error} />
      <Button variant="ink" onClick={save} disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : null} Save preferences</Button>
    </section>
  );
}
