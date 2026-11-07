import { createFileRoute } from "@tanstack/react-router";
import { SignedOutRoute } from "@/merchant/guards";
import { MerchantLogin } from "@/merchant/screens/AuthScreens";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/login")({
  head: () => merchantHead("Sign in", "Sign in to manage your shop on CPSE."),
  component: LoginScreen,
});

function LoginScreen() {
  return (
    <SignedOutRoute>
      <MerchantLogin />
    </SignedOutRoute>
  );
}
