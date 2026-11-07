import { createFileRoute } from "@tanstack/react-router";
import KhataPage from "@/merchant/features/tools/KhataPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/khata")({
  head: () => merchantHead("Khata", "Customer credit, payments and reminders."),
  component: KhataPage,
});
