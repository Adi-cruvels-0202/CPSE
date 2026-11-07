import { createFileRoute } from "@tanstack/react-router";
import { Navigate } from "@/merchant/router";

/** Any unknown merchant address lands on the dashboard, as before. */
export const Route = createFileRoute("/merchant/$")({
  component: () => <Navigate to="/dashboard" replace />,
});
