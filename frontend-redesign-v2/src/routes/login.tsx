import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/customer/auth";
import { AuthFrame } from "@/customer/components/AuthFrame";
import { Field } from "@/components/cpse/Field";
import { InlineError } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";
import { safeNext } from "@/customer/safeNext";

type Search = { next?: string };

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): Search => ({ next: typeof s["next"] === "string" ? (s["next"] as string) : undefined }),
  head: () => ({
    meta: [
      { title: "Sign in — CPSE" },
      { name: "description", content: "Sign in to CPSE to see your orders, addresses and khata." },
      { property: "og:title", content: "Sign in — CPSE" },
      { property: "og:description", content: "Sign in to order from your neighbourhood shops." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { next } = Route.useSearch();
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<any>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await signIn({ email: email.trim(), password });
      navigate({ to: safeNext(next), replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const fields = error?.fieldErrors ?? {};

  return (
    <AuthFrame
      title="Welcome back"
      lead="Sign in to see your orders, addresses and khata."
      footer={
        <>
          <p>
            New here?{" "}
            <Link to="/register" search={{ next }} className="font-bold text-foreground underline-offset-4 hover:underline">
              Create an account
            </Link>
          </p>
          <p>
            Run a shop?{" "}
            <a href="/v2/merchant/login" className="font-bold text-foreground underline-offset-4 hover:underline">
              Merchant sign in
            </a>
          </p>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" error={fields["email"]} />
        <div>
          <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={fields["password"]} />
          <div className="mt-2 text-right">
            <Link to="/forgot-password" className="text-sm font-semibold text-primary-strong hover:underline">
              Forgot your password?
            </Link>
          </div>
        </div>
        {error && !Object.keys(fields).length ? <InlineError error={error} /> : null}
        <Button type="submit" size="lg" className="w-full" disabled={pending || !email || !password}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthFrame>
  );
}
