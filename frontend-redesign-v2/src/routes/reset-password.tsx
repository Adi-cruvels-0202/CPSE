import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { endpoints } from "@/lib/cpse/endpoints";
import { AuthFrame } from "@/customer/components/AuthFrame";
import { Field } from "@/components/cpse/Field";
import { InlineError } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — CPSE" },
      { name: "description", content: "Choose a new password for your CPSE account." },
      { property: "og:title", content: "Set a new password — CPSE" },
      { property: "og:description", content: "Choose a new password for your CPSE account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPage,
});

/** The recovery token arrives in the query or the URL fragment, as in the original app. */
function readRecoveryToken() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("accessToken") ?? params.get("access_token");
  if (fromQuery) return fromQuery;
  const hash = window.location.hash;
  if (!hash) return null;
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  return fragment.get("access_token") ?? fragment.get("accessToken") ?? null;
}

function ResetPage() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<any>(null);
  const [done, setDone] = useState(false);

  useEffect(() => setToken(readRecoveryToken()), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmation) {
      setError({ message: "The two passwords don’t match." });
      return;
    }
    setPending(true);
    setError(null);
    try {
      await endpoints.auth.resetPassword({ accessToken: token, password });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  if (token === undefined) return null;

  if (!token) {
    return (
      <AuthFrame
        title="That link won’t work"
        lead="A reset link is missing from this address, or it has already been used."
        footer={<p>Need a new one? <Link to="/forgot-password" className="font-bold text-foreground hover:underline">Start again</Link></p>}
      >
        <span />
      </AuthFrame>
    );
  }

  if (done) {
    return (
      <AuthFrame title="Password updated" lead="You can sign in with your new password now.">
        <div className="flex items-center gap-3 rounded-2xl bg-success-soft p-4"><CheckCircle2 className="h-6 w-6 text-success" /> All set.</div>
        <Button asChild size="lg" variant="ink" className="mt-6 w-full"><Link to="/login">Sign in</Link></Button>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Set a new password">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters." />
        <Field label="Type it again" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        <InlineError error={error} />
        <Button type="submit" size="lg" className="w-full" disabled={pending || !password}>
          {pending ? <Loader2 className="animate-spin" /> : null} Save password
        </Button>
      </form>
    </AuthFrame>
  );
}
