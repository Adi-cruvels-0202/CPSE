import { createFileRoute } from "@tanstack/react-router";

/**
 * Same-origin pass-through to the local CPSE server for this preview.
 *
 * The CPSE server only accepts browser calls from its own origin, so the
 * redesigned apps call `/api/v1/*` here and this handler forwards the request
 * unchanged (method, path, query, body, bearer token, idempotency key) and
 * returns the server's answer as-is. No business logic lives here: the CPSE
 * server stays the only authority for auth, permissions and data.
 */
const UPSTREAM = "http://127.0.0.1:4000/api/v1";

const FORWARD_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "idempotency-key",
  "x-request-id",
  "accept",
  "x-cpse-signature",
];

const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "x-request-id",
  "content-disposition",
  "retry-after",
  "cache-control",
];

async function forward({ request, params }: { request: Request; params: { _splat?: string } }) {
  const incoming = new URL(request.url);
  const splat = (params._splat ?? "").replace(/^\/+/, "");
  const target = `${UPSTREAM}/${splat}${incoming.search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const hasBody = !["GET", "HEAD"].includes(request.method);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : null,
      redirect: "manual",
    });
  } catch {
    return Response.json(
      {
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "The CPSE server could not be reached. Please try again in a moment.",
        },
      },
      { status: 503 },
    );
  }

  const responseHeaders = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
  return new Response(body, { status: upstream.status, headers: responseHeaders });
}

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: forward,
      POST: forward,
      PUT: forward,
      PATCH: forward,
      DELETE: forward,
    },
  },
});
