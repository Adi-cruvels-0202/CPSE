import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  tone?: "paper" | "ink";
};

/** Labelled input with hint and inline error, wired for screen readers. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, className, type = "text", tone = "paper", id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [reveal, setReveal] = useState(false);
  const isPassword = type === "password";
  const describedBy = [hint ? `${inputId}-hint` : null, error ? `${inputId}-err` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={inputId} className="block text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          type={isPassword && reveal ? "text" : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-12 w-full rounded-xl border px-4 text-base outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-border-strong focus:ring-2 focus:ring-ring/30",
            tone === "paper" ? "border-input bg-paper" : "border-ink-line bg-sidebar-accent text-ink-foreground",
            error && "border-destructive",
            isPassword && "pr-20",
          )}
          {...props}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="absolute inset-y-1 right-1 flex items-center gap-1 rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-accent"
            aria-label={reveal ? "Hide password" : "Show password"}
          >
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {reveal ? "Hide" : "Show"}
          </button>
        ) : null}
      </div>
      {hint && !error ? (
        <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${inputId}-err`} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
});

export function TextArea({
  label,
  hint,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        className="min-h-24 w-full rounded-xl border border-input bg-paper px-4 py-3 text-base outline-none focus:border-border-strong focus:ring-2 focus:ring-ring/30"
        {...props}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
