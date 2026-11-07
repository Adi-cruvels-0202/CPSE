import { createFileRoute } from "@tanstack/react-router";
import StoreSetupPage from "@/merchant/features/store/StoreSetupPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/store/$tab")({
  head: () => merchantHead("Store setup", "Shop details, hours, delivery, payments and publishing."),
  component: StoreSetupPage,
});
