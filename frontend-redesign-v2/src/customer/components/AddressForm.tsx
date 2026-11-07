import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Field } from "@/components/cpse/Field";
import { InlineError } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

export type AddressInput = {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  postalCode: string;
  label: string;
};

const EMPTY: AddressInput = { recipientName: "", phone: "", line1: "", line2: "", landmark: "", city: "", state: "", postalCode: "", label: "" };

/** Same fields as the original address form; empty optional fields are omitted from the payload. */
export function toPayload(form: AddressInput) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(form)) {
    const t = v.trim();
    if (t) out[k] = t;
  }
  return out;
}

export function AddressForm({
  initial,
  submitLabel = "Save address",
  onSubmit,
  onCancel,
}: {
  initial?: Partial<AddressInput>;
  submitLabel?: string;
  onSubmit: (payload: Record<string, string>) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<AddressInput>({ ...EMPTY, ...Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, v ?? ""])) });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<any>(null);
  const fields = error?.fieldErrors ?? {};
  const set = (k: keyof AddressInput) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit(toPayload(form));
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      <Field label="Name" autoComplete="name" value={form.recipientName} onChange={set("recipientName")} error={fields.recipientName} required />
      <Field label="Phone" type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} error={fields.phone} required />
      <Field className="sm:col-span-2" label="House / flat, street" autoComplete="address-line1" value={form.line1} onChange={set("line1")} error={fields.line1} required />
      <Field label="Area (optional)" autoComplete="address-line2" value={form.line2} onChange={set("line2")} error={fields.line2} />
      <Field label="Landmark (optional)" value={form.landmark} onChange={set("landmark")} error={fields.landmark} />
      <Field label="City" autoComplete="address-level2" value={form.city} onChange={set("city")} error={fields.city} required />
      <Field label="State" autoComplete="address-level1" value={form.state} onChange={set("state")} error={fields.state} required />
      <Field label="PIN code" inputMode="numeric" autoComplete="postal-code" value={form.postalCode} onChange={set("postalCode")} error={fields.postalCode} required />
      <Field label="Label (optional)" placeholder="Home, Work…" value={form.label} onChange={set("label")} error={fields.label} />
      {error && !Object.keys(fields).length ? <InlineError error={error} className="sm:col-span-2" /> : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="ink" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null} {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
