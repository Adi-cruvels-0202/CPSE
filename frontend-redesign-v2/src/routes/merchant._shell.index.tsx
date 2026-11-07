import { createFileRoute } from "@tanstack/react-router";
import { Navigate } from "@/merchant/router";

export const Route = createFileRoute("/merchant/_shell/")({
  component: () => <Navigate to="/dashboard" replace />,
});
