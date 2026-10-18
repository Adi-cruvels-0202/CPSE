import http from 'node:http';
import request from 'supertest';
import { createApp, API_PREFIX } from '../../src/app.js';

export { API_PREFIX };

/**
 * One listening server per test file. Handing supertest the bare app makes it
 * bind a fresh ephemeral port for every request; with thousands of requests a
 * port freed a moment ago is sometimes taken by another process on the machine
 * between bind and connect, and the request is answered by that process. A
 * single bound server removes that churn. The app is stateless between
 * requests (rate limiting is off in tests), so sharing it changes nothing else.
 */
// Listening before any test runs: supertest binds a server that is not yet
// listening itself, which would race with this listen.
const server = http.createServer(createApp());
// Generous: a test may hold a connection idle while it awaits something else.
server.keepAliveTimeout = 60_000;
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
server.unref();

/** A supertest agent bound to this file's server. */
export function api() {
  return request(server);
}

/** Prefixes a path with the API version, e.g. url('/health') → '/api/v1/health'. */
export const url = (path) => `${API_PREFIX}${path}`;
