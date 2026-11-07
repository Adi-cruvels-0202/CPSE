import { createFileRoute } from "@tanstack/react-router";
import OrdersPage from "@/merchant/features/orders/OrdersPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/orders")({
  head: () => merchantHead("Orders", "Accept, prepare and hand over online orders."),
  component: OrdersPage,
});
