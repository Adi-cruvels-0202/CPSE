import { createFileRoute } from "@tanstack/react-router";
import PurchasesPage from "@/merchant/features/tools/PurchasesPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/purchases")({
  head: () => merchantHead("Purchases", "Suppliers, invoices and receiving stock."),
  component: PurchasesPage,
});
