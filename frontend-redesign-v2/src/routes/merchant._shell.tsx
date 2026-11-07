import { createFileRoute, Outlet } from "@tanstack/react-router";
import { MerchantRoute } from "@/merchant/guards";
import { MerchantShell } from "@/merchant/MerchantShell";

export const Route = createFileRoute("/merchant/_shell")({
  component: ShellLayout,
});

function ShellLayout() {
  return (
    <MerchantRoute>
      <MerchantShell>
        <Outlet />
      </MerchantShell>
    </MerchantRoute>
  );
}
