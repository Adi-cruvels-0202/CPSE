import { createFileRoute } from "@tanstack/react-router";
import ProductsPage from "@/merchant/features/products/ProductsPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/products")({
  head: () => merchantHead("Products", "Your catalogue: prices, variants, photos and stock."),
  component: ProductsPage,
});
