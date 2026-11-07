import { cn } from "@/lib/utils";
import { toneFor, paymentFor } from "@/lib/cpse/orderStatus";

const TONE_CLASS: Record<string, string> = {
  waiting: "text-warning bg-warning-soft",
  active: "text-info bg-info-soft",
  ready: "text-success bg-success-soft",
  done: "text-success bg-success-soft",
  stopped: "text-destructive bg-destructive-soft",
  neutral: "text-muted-foreground bg-muted",
};

export function Stamp({ tone = "neutral", children, className }: { tone?: string; children: React.ReactNode; className?: string }) {
  return <span className={cn("stamp", TONE_CLASS[tone] ?? TONE_CLASS["neutral"], className)}>{children}</span>;
}

export function OrderStamp({ status, label, className }: { status: string; label?: string | null; className?: string }) {
  return (
    <Stamp tone={toneFor(status)} className={className}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {label ?? status.replace(/_/g, " ")}
    </Stamp>
  );
}

export function PaymentStamp({ status }: { status: string }) {
  const p = paymentFor(status);
  if (!p) return null;
  return <Stamp tone={p.tone}>{p.label}</Stamp>;
}

export function OpenStamp({ isOpen, label }: { isOpen: boolean; label: string }) {
  return (
    <Stamp tone={isOpen ? "done" : "neutral"}>
      <span className={cn("h-1.5 w-1.5 rounded-full", isOpen ? "bg-success" : "bg-muted-foreground")} aria-hidden="true" />
      {label}
    </Stamp>
  );
}
