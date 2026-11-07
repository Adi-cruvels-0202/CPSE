import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { useAuth } from "@/customer/auth";
import { AuthFrame } from "@/customer/components/AuthFrame";
import { Field } from "@/components/cpse/Field";
import { InlineError } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";
import { safeNext } from "@/customer/safeNext";

type Search = { next?: string };

export const Route = createFileRoute("/register")({
  validateSearch: (s: Record<string, unknown>): Search => ({ next: typeof s["next"] === "string" ? (s["next"] as string) : undefined }),
  head: () => ({
    meta: [
      { title: "Create your account — CPSE" },
      { name: "description", content: "Create a CPSE account to order from neighbourhood shops for pickup or delivery." },
      { property: "og:title", content: "Create your account — CPSE" },
      { property: "og:description", content: "Order from neighbourhood shops for pickup or delivery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const { next } = Route.useSearch();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<any>(null);
  const [confirm, setConfirm] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await register({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      });
      if (result?.session) navigate({ to: safeNext(next), replace: true });
      else setConfirm(true);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  if (confirm) {
    return (
      <AuthFrame title="Check your email" lead={`We sent a confirmation link to ${form.email}. Open it, then sign in.`}>
        <div className="flex items-center gap-4 rounded-2xl bg-success-soft p-4 text-success">
          <MailCheck className="h-8 w-8 shrink-0" />
          <p className="text-sm text-foreground">The link may take a minute. Check your spam folder if it doesn’t arrive.</p>
        </div>
        <Button asChild size="lg" variant="ink" className="mt-6 w-full">
          <Link to="/login" search={{ next }}>Go to sign in</Link>
        </Button>
      </AuthFrame>
    );
  }

  const fields = error?.fieldErrors ?? {};

  return (
    <AuthFrame
      title="Create your account"
      lead="One account for every shop on CPSE."
      footer={
        <p>
          Already have one?{" "}
          <Link to="/login" search={{ next }} className="font-bold text-foreground hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Your name" autoComplete="name" required value={form.fullName} onChange={set("fullName")} error={fields["fullName"]} />
        <Field label="Email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} error={fields["email"]} />
        <Field label="Phone (optional)" type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} hint="So the shop can call about your order." error={fields["phone"]} />
        <Field label="Password" type="password" autoComplete="new-password" required value={form.password} onChange={set("password")} hint="At least 8 characters." error={fields["password"]} />
        {error && !Object.keys(fields).length ? <InlineError error={error} /> : null}
        <Button type="submit" size="lg" className="w-full" disabled={pending || !form.email || !form.password || !form.fullName}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthFrame>
  );
}
