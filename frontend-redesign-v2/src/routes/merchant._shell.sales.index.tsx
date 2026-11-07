import { createFileRoute } from "@tanstack/react-router";
import SalesHistoryPage from "@/merchant/features/sales/SalesHistoryPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/sales/")({
  head: () => merchantHead("Counter sales", "Bills rung up at the counter."),
  component: SalesHistoryPage,
});
