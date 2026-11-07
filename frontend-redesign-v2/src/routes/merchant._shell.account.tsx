import { createFileRoute } from "@tanstack/react-router";
import AccountSettingsPage from "@/merchant/features/account/AccountSettingsPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/account")({
  head: () => merchantHead("Account", "Your details, stores and sign-in."),
  component: AccountSettingsPage,
});
