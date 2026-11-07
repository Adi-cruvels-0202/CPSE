import { createFileRoute } from "@tanstack/react-router";
import SuggestionsPage from "@/merchant/features/tools/SuggestionsPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/suggestions")({
  head: () => merchantHead("What to reorder", "A suggested purchase list."),
  component: SuggestionsPage,
});
