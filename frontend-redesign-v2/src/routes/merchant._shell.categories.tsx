import { createFileRoute } from "@tanstack/react-router";
import CategoriesPage from "@/merchant/features/categories/CategoriesPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/categories")({
  head: () => merchantHead("Categories", "Group your products into aisles."),
  component: CategoriesPage,
});
