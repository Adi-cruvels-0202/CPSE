import { createFileRoute } from "@tanstack/react-router";
import CustomersPage from "@/merchant/features/tools/CustomersPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/customers")({
  head: () => merchantHead("Customers", "Who buys, how often, and your notes."),
  component: CustomersPage,
});
