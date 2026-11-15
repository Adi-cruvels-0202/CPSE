import { createFileRoute } from "@tanstack/react-router";
import merchantCss from "@/merchant/merchant.css?url";
import adminCss from "@/admin/admin.css?url";
import { ToastProvider } from "@/merchant/hooks/useToast";
import AdminApp from "@/admin/AdminApp";

/**
 * The CPSE admin console in the V2 design. Its own session
 * (cpse.admin.session), separate from the shop owner's and the shopper's.
 * The console picks its section from the address (/admin/overview, …).
 */
export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "CPSE admin" },
      { name: "description", content: "CPSE platform admin." },
      { name: "robots", content: "noindex" },
    ],
    links: [
      { rel: "stylesheet", href: merchantCss },
      { rel: "stylesheet", href: adminCss },
    ],
  }),
  component: AdminRoot,
});

function AdminRoot() {
  return (
    <div className="merchant-app min-h-screen bg-background">
      <ToastProvider>
        <AdminApp />
      </ToastProvider>
    </div>
  );
}
