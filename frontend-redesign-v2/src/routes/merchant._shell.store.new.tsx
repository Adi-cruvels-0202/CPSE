import { createFileRoute } from "@tanstack/react-router";
import StoreSetupPage from "@/merchant/features/store/StoreSetupPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/store/new")({
  head: () => merchantHead("New store", "Set up a new shop on CPSE."),
  component: Screen,
});

function Screen() {
  return <StoreSetupPage isNewStore />;
}
