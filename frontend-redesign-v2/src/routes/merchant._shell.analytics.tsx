import { createFileRoute } from "@tanstack/react-router";
import AnalyticsPage from "@/merchant/features/tools/AnalyticsPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/analytics")({
  head: () => merchantHead("Reports", "Sales, orders, best and slow sellers."),
  component: AnalyticsPage,
});
