# Deploying CPSE to Render (free tier)

Two services from one repo: a Node web service for the API and a static site for
the React app. `render.yaml` at the repo root declares both, so Render creates
them together rather than you filling in two dashboards by hand.

Supabase is already live and all 23 migrations are applied, so there is no
database step here. The same Supabase project serves local development and
production — if you would rather they were separate, that is a second Supabase
project and a second set of keys, noted at the bottom.

---

## Before you start

**What the free tier does.** The static site is genuinely free and always awake.
The web service sleeps after **15 minutes** without traffic and takes about **50
seconds** to wake up. There is no client-side request timeout, so a cold start
shows a long spinner rather than an error — but anyone opening the link cold will
think the app is broken. If you are sending this to someone to look at, read
*Keeping it awake* at the end first.

**What you need to hand:**

- the repo pushed to GitHub, including `render.yaml`
- your Supabase project URL and both keys, from the Supabase dashboard under
  **Project Settings → API**: the project URL, the `anon` public key, and the
  `service_role` secret key

The `service_role` key bypasses row-level security completely. It goes into
Render's dashboard, never into the repo. `render.yaml` marks it `sync: false`
precisely so it cannot be committed by accident.

---

## Step 1 — Push the blueprint

```bash
git add render.yaml DEPLOYMENT.md
git commit -m "chore: Render blueprint for the free tier"
git push
```

Render reads `render.yaml` from the default branch, so it has to be on `main`.

## Step 2 — Create the services

1. Sign in at <https://dashboard.render.com> with GitHub.
2. **New → Blueprint**.
3. Pick the CPSE repository and approve Render's access to it.
4. Render reads `render.yaml` and shows two services: **cpse-api** and **cpse**.

It then asks for every value marked `sync: false`. You do not know the final URLs
yet — Render's names must be globally unique, so if `cpse` is taken you will get
something like `cpse-a1b2`. So fill in the Supabase values properly now and put
**placeholders** in the URL fields, which Step 4 corrects:

| Variable | Now | Why a placeholder and not blank |
|---|---|---|
| `SUPABASE_URL` | `https://<your-ref>.supabase.co` | real value |
| `SUPABASE_ANON_KEY` | the `anon` key | real value |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` key | real value |
| `CORS_ORIGINS` | `https://placeholder.onrender.com` | — |
| `PASSWORD_RESET_REDIRECT_URL` | `https://placeholder.onrender.com/reset-password` | must parse as a URL or the app will not boot |
| `PAYMENT_MOCK_CHECKOUT_URL` | `https://placeholder.onrender.com/mock-payment` | same |
| `VITE_API_BASE_URL` | `https://placeholder.onrender.com/api/v1` | on the **static site**, not the API |

`PAYMENT_WEBHOOK_SECRET` is not in that list — `render.yaml` has Render generate
it, because a hand-picked one that someone can guess lets them mark an order
paid.

5. **Apply**. The first build takes a few minutes. The API may go red at first;
   that is expected while its URL variables are still placeholders.

## Step 3 — Write down the two real URLs

Open each service in the dashboard and copy the URL from the top of the page:

- the API, something like `https://cpse-api.onrender.com`
- the site, something like `https://cpse.onrender.com`

## Step 4 — Point them at each other

This is the step that makes it work, and the one place a typo costs you an hour.

**On `cpse-api` → Environment**, replace the three placeholders with the **static
site's** URL:

```
CORS_ORIGINS=https://cpse.onrender.com
PASSWORD_RESET_REDIRECT_URL=https://cpse.onrender.com/reset-password
PAYMENT_MOCK_CHECKOUT_URL=https://cpse.onrender.com/mock-payment
```

No trailing slash on `CORS_ORIGINS`. The backend compares the browser's `Origin`
header against this list as an exact string, and browsers never send a trailing
slash, so `https://cpse.onrender.com/` matches nothing and every request fails.

**On `cpse` → Environment**, set it to the **API's** URL, including the version
prefix:

```
VITE_API_BASE_URL=https://cpse-api.onrender.com/api/v1
```

Saving triggers a redeploy on each. The frontend one matters: Vite bakes this
value into the JavaScript bundle at build time, so it only takes effect once the
site is rebuilt. Changing it and restarting is not enough.

## Step 5 — Tell Supabase about the new URL

Supabase will only redirect to URLs it has been shown, so password reset emails
still point at localhost until you do this. In the Supabase dashboard, under
**Authentication → URL Configuration**:

- **Site URL**: `https://cpse.onrender.com`
- **Redirect URLs**: add `https://cpse.onrender.com/reset-password` and
  `https://cpse.onrender.com/**`

Email confirmation is already off, which is what lets a new account sign in
immediately.

## Step 6 — Check it actually works

The API first, which needs no browser:

```bash
curl https://cpse-api.onrender.com/api/v1/health
```

Expect `{"success":true,"data":{"status":"ok","environment":"production",...}}`.
If this is the first request in a while, give it a minute — that is the service
waking up, not a failure.

Then, in the browser, walk the path that touches everything:

1. Open the site. The shop list should load — that is the frontend reaching the
   API across origins, so CORS is right.
2. Create an account. Sign in.
3. Add something to the cart, check out, pay with the mock provider — this is the
   one that proves `PAYMENT_MOCK_CHECKOUT_URL` is correct, because a wrong value
   sends you to localhost and the payment never returns.
4. Open the order, then **View receipt**: items listed with quantities, totals
   lined up.
5. Cancel the paid order — it should tell you the money comes back within 7
   working days.
6. Reload on a deep link like `/orders`. A 404 here means the SPA rewrite in
   `render.yaml` did not apply.

If the shop list fails with a network error, open the browser console. A CORS
message means `CORS_ORIGINS` does not match the site's URL exactly.

---

## Keeping it awake

Fifty seconds of blank spinner reads as a broken app, and on the free tier there
is no setting that turns sleeping off. Your options, honestly:

- **Open the link yourself a minute before anyone else does.** Free, and enough
  for a scheduled demo.
- **Ping it every 10 minutes** from a free uptime checker (UptimeRobot, cron-job.org)
  against `/api/v1/health`. It works, and it is worth knowing that this spends
  your monthly free instance hours — 750 across the account — so a single service
  pinged constantly runs out near the end of the month.
- **Pay $7/month** for the starter plan on `cpse-api` only. The static site stays
  free. This is the only option that actually removes the problem.

## Notes

**Keep the API at one instance.** `express-rate-limit` counts in memory, so two
instances each keep their own tally and the limits halve. Not a free-tier concern
— worth remembering if you ever scale it.

**Deploys are automatic** on push to `main`, for both services.

**Logs** are under each service's **Logs** tab. The backend logs JSON with a
request id, and error responses carry the same id in `X-Request-Id`, so a report
of "it failed at 3pm" can be traced to one request.

**One Supabase project for local and production** means your development
database is the real one. If you want them separate: create a second Supabase
project, apply `backend/migrations/*.sql` in order through its SQL editor, run
`npm run db:seed` against it, and give Render that project's keys instead.
