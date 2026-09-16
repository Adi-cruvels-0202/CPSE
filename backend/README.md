# CPSE Backend

Customer Portal & Shopping Experience — Express API backed by Supabase (Postgres + Supabase Auth).

## Setup

```bash
cd backend
npm install
cp .env.example .env   # then fill in the Supabase values
```

Get the Supabase values from your project dashboard → **Project Settings → API**:

| Variable | Where |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key — **server-side only, never ship to the frontend** |

## Commands

```bash
npm run dev     # start with file watching
npm start       # start
npm test        # run the test suite
npm run test:watch
npm run test:coverage
```

## Conventions

**Base path:** every route is mounted under `/api/v1`.

**Success envelope**
```json
{ "success": true, "data": { }, "meta": { } }
```

**Error envelope**
```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "...", "details": {} }, "requestId": "..." }
```

`X-Request-Id` is echoed on every response; send your own to trace a request end to end.

**Ownership:** a resource that exists but belongs to another customer returns **404**, never 403 —
a 403 would confirm the resource exists.

## Layout

```
src/
  config/      env loading and validation (nothing else reads process.env)
  lib/         supabase clients, logger, errors, response helpers
  middleware/  request context, validation, rate limiting, error handler
  modules/     one folder per domain: routes + controller + service
  routes.js    the full URL map
  app.js       express assembly
  server.js    listen + graceful shutdown
tests/
```

See `../PROJECT_CHECKLIST.md` and `../PROJECT_CONTEXT.md` for the roadmap and current state.
