import { createFileRoute } from "@tanstack/react-router";
import InventoryPage from "@/merchant/features/inventory/InventoryPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/inventory/")({
  head: () => merchantHead("Stock", "Receive, count and write off stock."),
  component: InventoryPage,
});
