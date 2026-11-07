import { createFileRoute } from "@tanstack/react-router";
import BatchesPage from "@/merchant/features/tools/BatchesPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/batches")({
  head: () => merchantHead("Batches & expiry", "What is expiring and write-offs."),
  component: BatchesPage,
});
