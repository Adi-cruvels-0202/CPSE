import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "./auth";
import { LoadingRegion, Skel } from "@/components/cpse/States";

/** Client-side gate for customer pages, mirroring the original RequireAuth. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (status === "signedOut") {
      navigate({ to: "/login", search: { next: location.href }, replace: true });
    }
  }, [status, navigate, location.href]);

  if (status !== "signedIn") {
    return (
      <LoadingRegion label="Checking your account" className="mx-auto max-w-3xl space-y-4">
        <Skel className="h-10 w-1/2" />
        <Skel className="h-28 w-full rounded-2xl" />
        <Skel className="h-28 w-full rounded-2xl" />
      </LoadingRegion>
    );
  }
  return <>{children}</>;
}
