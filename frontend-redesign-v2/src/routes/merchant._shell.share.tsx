import { createFileRoute } from "@tanstack/react-router";
import SharePage from "@/merchant/features/tools/SharePage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/share")({
  head: () => merchantHead("Share your shop", "Link, QR code and WhatsApp."),
  component: SharePage,
});
