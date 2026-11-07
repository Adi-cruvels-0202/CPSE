import { createFileRoute } from "@tanstack/react-router";
import CatalogueToolsPage from "@/merchant/features/tools/CatalogueToolsPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/catalogue-tools")({
  head: () => merchantHead("Catalogue tools", "Templates, import/export and bulk changes."),
  component: CatalogueToolsPage,
});
