import { cn } from "@/lib/utils";

/** CPSE wordmark: an awning-striped shop mark next to the name. */
export function Logo({ size = "md", tone = "default", suffix, markOnly = false, markOnlyOnMobile = false }: { size?: "sm" | "md"; tone?: "default" | "ink"; suffix?: string; markOnly?: boolean; markOnlyOnMobile?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2", tone === "ink" ? "text-ink-foreground" : "text-foreground")}>
      <span
        aria-hidden="true"
        className={cn(
          "relative grid place-items-center overflow-hidden rounded-[10px] bg-primary text-primary-foreground",
          size === "sm" ? "h-7 w-7" : "h-9 w-9",
        )}
      >
        <svg viewBox="0 0 32 32" className="h-full w-full">
          <path d="M4 10h24l-2 6H6z" fill="currentColor" opacity="0.9" />
          <path d="M8 10h4l-1 6H7zM16 10h4l1 6h-4z" fill="var(--paper)" opacity="0.85" />
          <rect x="8" y="18" width="16" height="8" rx="1.5" fill="currentColor" opacity="0.9" />
          <rect x="14" y="20" width="4" height="6" fill="var(--primary)" />
        </svg>
      </span>
      <span className={cn(
        "overflow-hidden whitespace-nowrap font-display font-extrabold tracking-tight transition-[max-width,opacity] duration-150",
        size === "sm" ? "text-lg" : "text-2xl",
        markOnly ? "max-w-0 opacity-0" : markOnlyOnMobile ? "max-w-0 opacity-0 md:max-w-24 md:opacity-100" : "max-w-24 opacity-100",
      )}>
        CPSE
        {suffix ? <span className={cn("ml-1.5 font-sans text-xs font-bold uppercase tracking-[0.18em]", tone === "ink" ? "text-primary" : "text-primary-strong")}>{suffix}</span> : null}
      </span>
    </span>
  );
}
