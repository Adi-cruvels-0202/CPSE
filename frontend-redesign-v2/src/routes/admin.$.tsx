import { createFileRoute } from "@tanstack/react-router";

/**
 * /admin/overview, /admin/stores, … — the console (routes/admin.tsx) reads the
 * section from the address itself, so this only lets those addresses match.
 */
export const Route = createFileRoute("/admin/$")({
  component: () => null,
});
