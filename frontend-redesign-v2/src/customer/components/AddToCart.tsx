import { useState } from "react";
import { Minus, Plus, Loader2, ShoppingBasket } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { rememberStore } from "@/lib/cpse/activeStore";
import { useAuth } from "../auth";
import { useCart } from "../hooks";

/**
 * "Add" that becomes a − qty + stepper once the product is in the cart.
 * The cart is the source of truth: the stepper reads the line from it, and every
 * change goes through the same cart endpoints as the original app.
 */
export function AddToCart({
  storeId,
  storeSlug,
  productId,
  variantId,
  disabled,
  size = "md",
  onNeedsVariant,
  className,
}: {
  storeId: string;
  storeSlug: string;
  productId: string;
  variantId?: string | null;
  disabled?: boolean;
  size?: "md" | "lg";
  onNeedsVariant?: () => void;
  className?: string;
}) {
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const cart = useCart(storeId);
  const [pending, setPending] = useState(false);

  const lines = (cart.data?.cart?.lines ?? []).filter(
    (line: any) => line.productId === productId && (!variantId || line.variantId === variantId),
  );
  const line = lines.length === 1 ? lines[0] : null;
  const quantity = lines.reduce((sum: number, l: any) => sum + l.quantity, 0);

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setPending(true);
    try {
      await fn();
      rememberStore({ id: storeId, slug: storeSlug });
      if (success) toast.success(success);
    } catch (error: any) {
      if (error?.code === "VARIANT_REQUIRED" && onNeedsVariant) onNeedsVariant();
      else toast.error(error?.message ?? "Could not update your cart.");
    } finally {
      setPending(false);
    }
  };

  const add = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isSignedIn) {
      navigate({ to: "/login", search: { next: location.href } });
      return;
    }
    run(
      () => endpoints.cart.addItem({ storeId, productId, ...(variantId ? { variantId } : {}), quantity: 1 }),
      quantity === 0 ? "Added to your cart" : undefined,
    );
  };

  const change = (event: React.MouseEvent, delta: number) => {
    event.preventDefault();
    event.stopPropagation();
    if (!line) return add(event);
    const next = line.quantity + delta;
    run(() => (next < 1 ? endpoints.cart.removeItem(line.id) : endpoints.cart.updateItem(line.id, { quantity: next })));
  };

  const h = size === "lg" ? "h-12 text-base" : "h-9 text-sm";

  if (quantity > 0 && (line || lines.length > 1)) {
    return (
      <div
        className={cn(
          "inline-flex items-center justify-between overflow-hidden rounded-full bg-ink text-ink-foreground animate-drop-in",
          h,
          size === "lg" ? "w-full max-w-xs" : "w-[6.5rem]",
          className,
        )}
        role="group"
        aria-label="Quantity in cart"
      >
        <button
          type="button"
          onClick={(e) => change(e, -1)}
          disabled={pending || !line}
          className="grid h-full w-9 place-items-center hover:bg-sidebar-accent disabled:opacity-50"
          aria-label={quantity === 1 ? "Remove from cart" : "Remove one"}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="numeric min-w-6 text-center font-bold" aria-live="polite">
          {pending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : <span key={quantity} className="inline-block animate-tick">{quantity}</span>}
        </span>
        <button
          type="button"
          onClick={(e) => change(e, 1)}
          disabled={pending || !line}
          className="grid h-full w-9 place-items-center hover:bg-sidebar-accent disabled:opacity-50"
          aria-label="Add one more"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={disabled || pending}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full border border-border-strong bg-card px-4 font-bold transition-colors hover:bg-primary hover:border-primary-strong disabled:cursor-not-allowed disabled:opacity-50",
        h,
        size === "lg" ? "w-full max-w-xs" : "w-[6.5rem]",
        className,
      )}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : size === "lg" ? <ShoppingBasket className="h-5 w-5" /> : <Plus className="h-4 w-4" />}
      {disabled ? "Sold out" : isSignedIn ? (size === "lg" ? "Add to cart" : "Add") : size === "lg" ? "Sign in to add" : "Add"}
    </button>
  );
}
