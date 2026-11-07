import { createFileRoute } from "@tanstack/react-router";
import PromotionsPage from "@/merchant/features/tools/PromotionsPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/promotions")({
  head: () => merchantHead("Loyalty & offers", "Points, discount codes and expiry offers."),
  component: PromotionsPage,
});
