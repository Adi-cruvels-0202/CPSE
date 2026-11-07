import { createFileRoute } from "@tanstack/react-router";
import NewSalePage from "@/merchant/features/sales/NewSalePage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/sales/new")({
  head: () => merchantHead("New sale", "Bill a walk-in customer."),
  component: NewSalePage,
});
