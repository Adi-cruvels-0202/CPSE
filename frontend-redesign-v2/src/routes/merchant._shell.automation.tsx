import { createFileRoute } from "@tanstack/react-router";
import AutomationPage from "@/merchant/features/tools/AutomationPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/automation")({
  head: () => merchantHead("Automation", "Recurring tasks and alerts."),
  component: AutomationPage,
});
