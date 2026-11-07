import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2, ReceiptText, ClipboardList, Calculator, MailCheck } from "lucide-react";
import { Logo } from "@/components/cpse/Logo";
import { Field } from "@/components/cpse/Field";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/merchant/hooks/useAuth";
import { ApiError, errorMessage } from "@/merchant/api/client";
import { Link } from "@/merchant/router";

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-ink p-12 text-ink-foreground lg:flex lg:flex-col">
        <div className="awning absolute inset-x-0 top-0 h-3 opacity-80" aria-hidden="true" />
        <Logo tone="ink" suffix="Shops" />
        <div className="mt-auto max-w-md">
          <h1 className="font-display text-5xl font-extrabold leading-[1.02] tracking-tight">
            Your shop, online <span className="text-primary">and at the counter.</span>
          </h1>
          <p className="mt-5 text-lg text-ink-muted">Take orders from your neighbourhood, keep stock straight and ring up walk-ins.</p>
          <ul className="mt-10 space-y-3 text-sm">
            {[
              [ReceiptText, "Accept and hand over online orders"],
              [ClipboardList, "Stock that stays right, batch by batch"],
              [Calculator, "A fast counter bill for walk-ins"],
            ].map(([Icon, text]: any) => (
              <li key={text} className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-sidebar-accent text-primary">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <main className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Logo suffix="Shops" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

export function MerchantLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const { login } = useAuth();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(errorMessage(err, "Sign in failed. Please try again."));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthFrame>
      <h2 className="text-3xl font-extrabold">Welcome back</h2>
      <p className="mt-1 text-muted-foreground">Sign in to manage your shop.</p>
      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
        {error ? (
          <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive-soft px-4 py-3 text-sm text-destructive">{error}</p>
        ) : null}
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" autoFocus />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" required autoComplete="current-password" />
        <Button type="submit" variant="ink" size="lg" className="w-full" disabled={isLoading}>
          {isLoading ? <Loader2 className="animate-spin" /> : null}
          {isLoading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="mt-8 space-y-2 border-t border-dashed pt-6 text-sm">
        <p>
          New to selling here? <Link to="/register" className="font-bold text-primary-strong underline-offset-4 hover:underline">Create a merchant account</Link>
        </p>
        <p className="text-muted-foreground">
          Here to shop? <a href="/v2/login" className="font-semibold text-foreground underline-offset-4 hover:underline">Customer sign in</a>
        </p>
      </div>
    </AuthFrame>
  );
}

export function MerchantRegister() {
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "", confirm: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { register } = useAuth();
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [field]: event.target.value });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (form.password.length < 8) return setError("Use at least 8 characters for the password.");
    if (form.password !== form.confirm) return setError("The passwords do not match.");
    setIsLoading(true);
    try {
      const { confirmEmail } = await register({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: form.phone.trim() || undefined,
      });
      if (confirmEmail) setSentTo(form.email);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "An account with that email already exists. A shop needs its own email — if this one is your shopping account, use a different email for the shop."
          : errorMessage(err, "Could not create the account. Please try again."),
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthFrame>
      {sentTo ? (
        <div role="status" className="surface p-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-success-soft text-success">
            <MailCheck className="h-7 w-7" />
          </span>
          <h2 className="mt-4 text-2xl font-extrabold">Check your inbox</h2>
          <p className="mt-2 text-muted-foreground">
            We sent a link to <strong className="text-foreground">{sentTo}</strong>. Open it to confirm your email, then sign in.
          </p>
          <Button asChild variant="ink" className="mt-6">
            <Link to="/login">Go to sign in</Link>
          </Button>
        </div>
      ) : (
        <>
          <h2 className="text-3xl font-extrabold">Open your shop</h2>
          <p className="mt-1 text-muted-foreground">A separate account for selling — your shopping login stays as it is.</p>
          <form className="mt-8 grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
            {error ? (
              <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive-soft px-4 py-3 text-sm text-destructive sm:col-span-2">{error}</p>
            ) : null}
            <Field className="sm:col-span-2" label="Your name" value={form.fullName} onChange={set("fullName")} required autoComplete="name" autoFocus maxLength={120} />
            <Field label="Email" type="email" value={form.email} onChange={set("email")} required autoComplete="email" />
            <Field label="Phone (optional)" type="tel" value={form.phone} onChange={set("phone")} placeholder="+919876543210" autoComplete="tel" />
            <Field label="Password" type="password" value={form.password} onChange={set("password")} placeholder="At least 8 characters" required minLength={8} autoComplete="new-password" />
            <Field label="Confirm password" type="password" value={form.confirm} onChange={set("confirm")} required autoComplete="new-password" />
            <Button type="submit" variant="ink" size="lg" className="w-full sm:col-span-2" disabled={isLoading}>
              {isLoading ? <Loader2 className="animate-spin" /> : null}
              {isLoading ? "Creating account…" : "Create account"}
            </Button>
          </form>
          <p className="mt-8 border-t border-dashed pt-6 text-sm">
            Already have an account? <Link to="/login" className="font-bold text-primary-strong underline-offset-4 hover:underline">Sign in</Link>
          </p>
        </>
      )}
    </AuthFrame>
  );
}
