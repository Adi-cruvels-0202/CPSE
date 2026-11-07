import type { ReactNode } from "react";
import { ShoppingBasket, Clock, ReceiptText } from "lucide-react";

/** Split sign-in frame: a brand panel beside the form on desktop, form only on phones. */
export function AuthFrame({ title, lead, children, footer }: { title: string; lead?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-5xl overflow-hidden rounded-3xl border border-border-strong/15 bg-card md:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden flex-col justify-between bg-ink p-10 text-ink-foreground md:flex">
        <div className="awning absolute inset-x-0 top-0 h-3 text-primary" aria-hidden="true" />
        <div>
          <p className="font-display text-4xl font-extrabold leading-tight">
            The shops you know,
            <br />
            <span className="text-primary">without the queue.</span>
          </p>
        </div>
        <ul className="space-y-4 text-sm text-ink-muted">
          <li className="flex gap-3"><ShoppingBasket className="h-5 w-5 shrink-0 text-primary" /> One cart per shop, priced live from their shelf.</li>
          <li className="flex gap-3"><Clock className="h-5 w-5 shrink-0 text-primary" /> Pickup on your way, or delivery to your door.</li>
          <li className="flex gap-3"><ReceiptText className="h-5 w-5 shrink-0 text-primary" /> Orders, receipts and khata in one place.</li>
        </ul>
      </aside>
      <section className="p-6 sm:p-10">
        <h1 className="text-3xl font-extrabold">{title}</h1>
        {lead ? <p className="mt-2 text-muted-foreground">{lead}</p> : null}
        <div className="mt-8">{children}</div>
        {footer ? <div className="mt-8 space-y-2 border-t border-dashed pt-6 text-sm text-muted-foreground">{footer}</div> : null}
      </section>
    </div>
  );
}
