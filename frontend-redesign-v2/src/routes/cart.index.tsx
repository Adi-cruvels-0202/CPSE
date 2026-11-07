import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ShoppingBasket } from "lucide-react";
import { readActiveStore } from "@/lib/cpse/activeStore";
import { RequireAuth } from "@/customer/RequireAuth";
import { EmptyState } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/cart/")({
  head: () => ({
    meta: [
      { title: "Your cart — CPSE" },
      { name: "description", content: "Review the items in your CPSE cart." },
      { property: "og:title", content: "Your cart — CPSE" },
      { property: "og:description", content: "Review the items in your CPSE cart." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <CartIndex />
    </RequireAuth>
  ),
});

/** Carts are per shop: "Cart" means the last shop the customer was in. */
function CartIndex() {
  const navigate = useNavigate();
  const active = typeof window === "undefined" ? null : readActiveStore();

  useEffect(() => {
    if (active?.id) navigate({ to: "/cart/$storeId", params: { storeId: active.id }, replace: true });
  }, [active?.id, navigate]);

  if (active?.id) return null;
  return (
    <EmptyState icon={<ShoppingBasket />} title="Your cart is empty" body="Every shop keeps its own cart. Open a shop and add something to start one.">
      <Button asChild variant="ink">
        <Link to="/">Find a shop</Link>
      </Button>
    </EmptyState>
  );
}
