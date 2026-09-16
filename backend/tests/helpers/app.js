import request from 'supertest';
import { createApp, API_PREFIX } from '../../src/app.js';

export { API_PREFIX };

/** A supertest agent bound to a fresh app instance. */
export function api() {
  return request(createApp());
}

/** Prefixes a path with the API version, e.g. url('/health') → '/api/v1/health'. */
export const url = (path) => `${API_PREFIX}${path}`;
