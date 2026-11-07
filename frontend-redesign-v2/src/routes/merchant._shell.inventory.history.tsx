import { createFileRoute } from "@tanstack/react-router";
import InventoryHistoryPage from "@/merchant/features/inventory/InventoryHistoryPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/inventory/history")({
  head: () => merchantHead("Stock history", "Every stock movement, newest first."),
  component: InventoryHistoryPage,
});
