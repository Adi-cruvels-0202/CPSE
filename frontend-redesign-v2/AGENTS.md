<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules

- The app is a redesign of the CPSE frontends: the customer shop lives at `/`, the merchant dashboard under `/merchant/*`, mirroring the original URL paths. Why: existing links, QR codes and emails keep working.
- All data comes from the live CPSE server through the pass-through route `src/routes/api/v1/$.ts`; never add business logic, data stores or auth of our own. Why: the CPSE server is the single authority for auth, permissions and data.
- Client logic in `src/lib/cpse/*` and `src/merchant/api/*` is ported from the original apps and kept behaviourally identical (`// @ts-nocheck` on verbatim ports). Why: behaviour parity with the source apps.
- Customer and merchant sessions are stored separately in browser storage (`cpse.session`, `cpse.merchant.session`), as in the source apps. Why: the server treats shop and customer accounts as separate logins.
- `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` and `noUncheckedIndexedAccess` are off in tsconfig. Why: the ported CPSE screens (originally non-strict) and API payloads rely on optional-undefined props, indexed access and loose JSON.
- All colours, tints, shadows and motion live as tokens/utilities in `src/styles.css` ("Bazaar Ledger" system); components never hardcode colours. Why: one design system across both apps.
- Merchant screens under `src/merchant/features/**` are the original merchant pages ported verbatim except for routing: they import `@/merchant/router` (a react-router-shaped shim over TanStack that prefixes `/merchant`) instead of `react-router-dom`. Why: keeps every merchant interaction identical while URLs stay under `/merchant`.
- Merchant feature styling lives in `src/merchant/merchant.css`, generated from the original merchant CSS with every rule nested under `.merchant-app` and the original token names remapped to the design-system tokens; it loads only via the `/merchant` route head. Why: merchant classes (`.btn`, `.card`, `.table`…) must never leak into the customer app.
- New merchant chrome and redesigned merchant screens (shell, sign-in, dashboard) live in `src/merchant/MerchantShell.tsx` and `src/merchant/screens/*`, written in Tailwind with design tokens. Why: redesigned screens replace ported ones one at a time without touching shared behaviour.
