import { createFileRoute } from "@tanstack/react-router";
import InsightsPage from "@/merchant/features/tools/InsightsPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/insights")({
  head: () => merchantHead("Insights", "Demand, stock health and your area."),
  component: InsightsPage,
});
