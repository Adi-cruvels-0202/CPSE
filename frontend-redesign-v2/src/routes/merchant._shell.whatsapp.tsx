import { createFileRoute } from "@tanstack/react-router";
import WhatsAppPage from "@/merchant/features/tools/WhatsAppPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/whatsapp")({
  head: () => merchantHead("WhatsApp", "Run your shop from WhatsApp: orders, sales, stock and alerts."),
  component: WhatsAppPage,
});
