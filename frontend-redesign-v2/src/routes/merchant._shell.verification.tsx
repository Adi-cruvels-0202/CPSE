import { createFileRoute } from "@tanstack/react-router";
import VerificationPage from "@/merchant/features/tools/VerificationPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/verification")({
  head: () => merchantHead("Verification", "Business details and documents."),
  component: VerificationPage,
});
