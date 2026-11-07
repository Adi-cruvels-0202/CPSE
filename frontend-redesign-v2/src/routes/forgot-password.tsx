import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { endpoints } from "@/lib/cpse/endpoints";
import { AuthFrame } from "@/customer/components/AuthFrame";
import { Field } from "@/components/cpse/Field";
import { InlineError } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset your password — CPSE" },
      { name: "description", content: "Get a link to set a new CPSE password." },
      { property: "og:title", content: "Reset your password — CPSE" },
      { property: "og:description", content: "Get a link to set a new CPSE password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgotPage,
});

function ForgotPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<any>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await endpoints.auth.forgotPassword({ email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthFrame
      title={sent ? "Check your email" : "Forgot your password?"}
      lead={sent ? `If ${email} has an account, a reset link is on its way.` : "Enter your email and we’ll send you a link to set a new one."}
      footer={
        <p>
          Remembered it?{" "}
          <Link to="/login" className="font-bold text-foreground hover:underline">Sign in</Link>
        </p>
      }
    >
      {sent ? (
        <div className="flex items-center gap-4 rounded-2xl bg-success-soft p-4">
          <MailCheck className="h-8 w-8 shrink-0 text-success" />
          <p className="text-sm">The link opens the CPSE site to set your new password.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5" noValidate>
          <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <InlineError error={error} />
          <Button type="submit" size="lg" className="w-full" disabled={pending || !email}>
            {pending ? <Loader2 className="animate-spin" /> : null} Send reset link
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}
