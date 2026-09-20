# CPSE Frontend

Customer Portal & Shopping Experience — React + Vite, mobile-first.

## Setup

```bash
cd frontend
npm install
cp .env.example .env
npm run dev          # http://localhost:5173
```

The backend must be running on `http://localhost:4000` (`cd backend && npm run dev`). Its
`CORS_ORIGINS` already allows `http://localhost:5173`, which is why the Vite port is pinned with
`strictPort` — Vite silently moving to 5174 would look like a CORS bug.

| Variable | |
|---|---|
| `VITE_API_BASE_URL` | Where the backend lives, including the `/api/v1` prefix. |

Vite only exposes `VITE_`-prefixed variables to the browser, and everything it exposes is public by
the time it ships. **Nothing secret belongs in this app's environment** — no service-role key, no
webhook secret.

## Commands

```bash
npm run dev
npm run build         # type-free production build into dist/
npm run preview       # serve the build
npm test
npm run test:watch
npm run test:coverage
```

## What is built

Checklist **11.1** and **11.2** — the scaffold and the API layer. Every other Phase 11 screen is
routed as a placeholder naming the checklist item that fills it in, so navigation can be walked end
to end before the screens exist.

```
src/
  lib/
    api.js        the one fetch wrapper: envelope, bearer token, refresh + replay
    endpoints.js  every backend call, named — the mirror of the backend's routes.js
    tokens.js     where the access/refresh pair lives, and why
    money.js      integer paise → ₹, the only place anything divides by 100
  context/
    AuthContext.jsx   who is signed in; three states, because "not sure yet" is one
  components/
    AppShell.jsx      header, bottom tabs, skip link — the frame every screen sits in
    RequireAuth.jsx   the gate; shows a spinner rather than a redirect while checking
    ErrorBoundary.jsx the white-screen catcher
  hooks/
    useSubmit.js  pending, fieldErrors and the error banner, for every form
  routes/
    auth/         Login, Register, ForgotPassword, ResetPassword, AuthLayout
    Account.jsx   profile editing, the links to everything owned, sign out
    Home.jsx  NotFound.jsx  Placeholder.jsx
  styles/
    tokens.css    the green palette, spacing, type scale — one file to change a theme
    global.css    reset plus the primitives (button, field, card, badge, notice, skeleton)
```

## The API layer

Screens never call `fetch`. They call `endpoints.cart.addItem(...)` and get back `{ data, meta }`
or a thrown `ApiError`.

`ApiError` carries `status`, `code`, `message` (the server's own wording, written for the customer),
`requestId` for a bug report, and `fieldErrors` — a 422's issues flattened to `{ field: message }`
for a form to render under its inputs.

**Refresh is automatic and happens once.** A 401 on a request that carried a token rotates the pair
and replays the request, so an expiring token does not interrupt a checkout. Several requests
failing together share one refresh — firing one per request would rotate the token repeatedly and
sign the customer out for having a fast connection.

Each call declares how it authenticates, and this is the part worth getting right:

| Mode | Used by |
|---|---|
| `none` | login, register, the password-reset pair — never sends a token, even when one is stored |
| `optional` | public store pages: they must open from a shared link with no session, and personalise with one |
| `required` | everything a customer owns. A 401 triggers the refresh-and-replay |

## Forms

Every form goes through `useSubmit`, which owns the four things each one needs: a disabled button
while in flight (so a double tap cannot submit twice), a 422's issues under the right inputs, the one
error that is not about a field, and clearing both on retry.

**The server's message is displayed as written.** `ApiError.message` is customer-facing by contract,
so re-phrasing it here would mean two copies of the same sentence drifting apart. The sign-in screen
is the sharpest case: the backend answers a wrong password and an unknown email identically, and a
client trying to be more helpful would rebuild the account-existence oracle the server avoids.

A 422 whose issues are all field-level shows no banner — the inputs already explain it.

### What the auth screens handle that is easy to miss

- **Registering with email confirmation on** returns no session. The screen says "check your inbox"
  rather than appearing to do nothing.
- **Sign-in returns the customer to where they were going.** `RequireAuth` puts the intended path in
  location state.
- **The reset screen reads the recovery token from the query string or the URL fragment**, because
  Supabase puts it in the fragment. With no token it says the link will not work instead of showing a
  form that cannot submit.
- **The account screen sends only what changed**, and `null` rather than `''` to clear a phone.
  Email is shown but not editable: the backend rejects an email change with a 422 rather than
  ignoring it, so offering the input would be a trap.

## Theme

Green, from `src/styles/tokens.css`. It is a grocery portal: green reads as fresh produce and
matches the kirana signage customers already know. One hue family plus a warm amber for anything
that interrupts, so "this is a different kind of thing" is never carried by green alone.

Contrast is checked, not guessed: `--green-700` on white is 5.3:1, `--green-800` is 7.4:1, and
white on `--green-600` is 4.6:1 — all clear WCAG AA for the sizes they are used at. The pale tints
are surfaces only, never text.

## Layout

Mobile-first, and on a desktop it stays a phone-width column (`--app-max-width: 32rem`): a grocery
list does not get better at 1400px, and one layout is one thing to get right.

Tap targets are at least 44px. The bottom tab bar is where a thumb reaches, and it is hidden on
public store pages — offering "Orders" and "Account" to someone who followed a shared link and has
neither is noise.

## Accessibility

Not a later pass. A skip link, a focusable `<main>` landmark, a visible focus ring on everything
interactive, `aria-current` on the active tab (colour alone is not a state), `role="status"` on
loading text, labels on every field, and `prefers-reduced-motion` honoured by the spinner and the
skeleton shimmer. Pinch-zoom is left enabled.

## Tests

`npm test` — 169 tests, no network and no backend required.

They cover what silently breaks: the refresh-and-replay path including the parallel case, a
network failure not being mistaken for a sign-out, session storage surviving a browser that refuses
to store anything, public routes opening with a genuinely empty session, gated routes redirecting,
the auth gate not flickering through a redirect while it checks, and every endpoint's auth mode —
because a public page that demands a token works perfectly when you are signed in and is broken for
every shared link.

See `../backend/docs/API.md` for the contract these are written against.
