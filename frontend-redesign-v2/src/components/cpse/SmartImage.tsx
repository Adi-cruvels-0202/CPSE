import { useState } from "react";
import { cn } from "@/lib/utils";
import { initials } from "@/customer/categories";

/**
 * A remote image that degrades to a monogram tile when the URL is empty or
 * fails to load (seeded data uses placeholder hosts that never resolve).
 */
export function SmartImage({
  src,
  name,
  alt,
  className,
  fallbackClassName,
  icon,
}: {
  src?: string | null;
  name: string;
  alt: string;
  className?: string;
  fallbackClassName?: string;
  icon?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const usable = Boolean(src) && !failed && !String(src).includes(".local/");

  if (!usable) {
    return (
      <div
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        className={cn("grid place-items-center font-display font-extrabold", className, fallbackClassName)}
      >
        {icon ?? <span>{initials(name)}</span>}
      </div>
    );
  }

  return (
    <img
      src={src!}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}
