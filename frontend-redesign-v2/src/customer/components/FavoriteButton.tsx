import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { useAuth } from "../auth";

/**
 * Favourite (save) a shop. Optimistic: the heart fills at once and reverts with
 * a message if the server refuses. Signed-out taps go to sign-in and come back.
 */
export function FavoriteButton({
  storeId,
  storeName,
  isSaved,
  className,
  size = "md",
}: {
  storeId: string;
  storeName: string;
  isSaved: boolean | null | undefined;
  className?: string;
  size?: "md" | "lg";
}) {
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(isSaved === true);
  const [busy, setBusy] = useState(false);
  const [popKey, setPopKey] = useState(0);

  useEffect(() => setSaved(isSaved === true), [isSaved]);

  const toggle = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isSignedIn) {
      navigate({ to: "/login", search: { next: location.href } });
      return;
    }
    if (busy) return;
    const next = !saved;
    setSaved(next);
    setPopKey((k) => k + 1);
    setBusy(true);
    try {
      if (next) await endpoints.stores.save(storeId);
      else await endpoints.stores.unsave(storeId);
      toast.success(next ? `${storeName} saved to favourites` : `${storeName} removed from favourites`);
      queryClient.invalidateQueries({ queryKey: ["saved-stores"] });
      queryClient.invalidateQueries({ queryKey: ["store"] });
    } catch (error: any) {
      setSaved(!next);
      toast.error(error?.message ?? "Could not update favourites.");
    } finally {
      setBusy(false);
    }
  };

  const label = !isSignedIn
    ? `Save ${storeName} — sign in first`
    : saved
      ? `Remove ${storeName} from favourites`
      : `Save ${storeName} to favourites`;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isSignedIn ? saved : undefined}
      aria-label={label}
      title={label}
      className={cn(
        "grid shrink-0 place-items-center rounded-full border bg-card/95 backdrop-blur transition-colors",
        size === "lg" ? "h-11 w-11" : "h-9 w-9",
        saved
          ? "border-destructive/50 text-destructive"
          : "border-border text-foreground hover:border-border-strong hover:text-destructive",
        className,
      )}
    >
      <Heart
        key={popKey}
        className={cn(size === "lg" ? "h-5 w-5" : "h-[18px] w-[18px]", popKey > 0 && "animate-heart-pop")}
        fill={saved ? "currentColor" : "none"}
        strokeWidth={2}
      />
    </button>
  );
}
