import { createFileRoute } from "@tanstack/react-router";
import { SignedOutRoute } from "@/merchant/guards";
import { MerchantRegister } from "@/merchant/screens/AuthScreens";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/register")({
  head: () => merchantHead("Open your shop", "Create a merchant account and put your shop on CPSE."),
  component: RegisterScreen,
});

function RegisterScreen() {
  return (
    <SignedOutRoute>
      <MerchantRegister />
    </SignedOutRoute>
  );
}
