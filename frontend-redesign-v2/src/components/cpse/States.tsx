import type { ReactNode } from "react";
import { AlertTriangle, WifiOff, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Quiet, content-shaped placeholder. No shimmer: a soft pulse that stops under reduced motion. */
export function Skel({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-sunk", className)} />;
}

export function LoadingRegion({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  children,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("surface flex flex-col items-center gap-3 border-dashed px-6 py-12 text-center", className)}>
      {icon ? (
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary-strong [&_svg]:h-7 [&_svg]:w-7">
          {icon}
        </div>
      ) : null}
      <h2 className="text-xl font-bold">{title}</h2>
      {body ? <p className="max-w-sm text-muted-foreground">{body}</p> : null}
      {children ? <div className="mt-2 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  title,
  onRetry,
  className,
}: {
  error?: any;
  title?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const offline = error?.status === 0 || error?.code === "NETWORK_ERROR";
  return (
    <div
      role="alert"
      className={cn(
        "surface flex flex-col items-center gap-3 border-destructive/40 bg-destructive-soft/50 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-destructive-soft text-destructive">
        {offline ? <WifiOff className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
      </div>
      <h2 className="text-lg font-bold">{title ?? (offline ? "You seem to be offline" : "That did not load")}</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {error?.message ?? "Something went wrong. Please try again."}
      </p>
      {error?.requestId ? (
        <p className="numeric text-xs text-muted-foreground">Reference: {error.requestId}</p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw /> Try again
        </Button>
      ) : null}
    </div>
  );
}

export function InlineError({ error, className }: { error: any; className?: string }) {
  if (!error) return null;
  const fields = error?.fieldErrors ? Object.values(error.fieldErrors as Record<string, string>) : [];
  return (
    <p role="alert" className={cn("rounded-lg border border-destructive/40 bg-destructive-soft px-3 py-2 text-sm text-destructive", className)}>
      {error?.code === "VALIDATION_FAILED" && fields.length > 0 ? fields[0] : error?.message ?? "Something went wrong."}
    </p>
  );
}

export function PageTitle({
  eyebrow,
  title,
  body,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-primary-strong">{eyebrow}</p>
        ) : null}
        <h1 className="text-3xl font-extrabold sm:text-4xl">{title}</h1>
        {body ? <p className="mt-2 text-muted-foreground">{body}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap justify-end gap-2">{actions}</div> : null}
    </header>
  );
}
