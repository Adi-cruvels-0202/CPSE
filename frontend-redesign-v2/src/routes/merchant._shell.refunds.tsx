import { createFileRoute } from "@tanstack/react-router";
import RefundsPage from "@/merchant/features/tools/RefundsPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/refunds")({
  head: () => merchantHead("Refunds", "Money owed back on cancelled orders."),
  component: RefundsPage,
});
