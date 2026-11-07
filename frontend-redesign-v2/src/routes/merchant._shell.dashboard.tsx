import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/merchant/screens/Dashboard";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/dashboard")({
  head: () => merchantHead("Today", "Today’s takings, orders waiting and stock running low."),
  component: Dashboard,
});
