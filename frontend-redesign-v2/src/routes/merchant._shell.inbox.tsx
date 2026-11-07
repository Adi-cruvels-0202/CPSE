import { createFileRoute } from "@tanstack/react-router";
import InboxPage from "@/merchant/features/tools/InboxPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/inbox")({
  head: () => merchantHead("Inbox", "Alerts, refunds and messages that need you."),
  component: InboxPage,
});
