import { createFileRoute } from "@tanstack/react-router";
import MorePage from "@/merchant/features/tools/MorePage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/more")({
  head: () => merchantHead("More tools", "Everything else for running your shop."),
  component: MorePage,
});
