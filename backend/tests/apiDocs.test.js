import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRoutes, routeKey, PUBLIC_ROUTES } from './helpers/routes.js';
import { apiRouter } from '../src/routes.js';

/**
 * Checklist 10.8. Documentation nobody checks is worse than none: it is read as
 * true. So docs/API.md is compared against the router it describes — a new
 * endpoint that is not written down fails here, and so does a documented one
 * that no longer exists.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const doc = await readFile(path.join(HERE, '..', 'docs', 'API.md'), 'utf8');
const ROUTES = collectRoutes(apiRouter);

/** Every `METHOD /path` inside a code span in the document. */
function documentedRoutes(markdown) {
  const found = new Set();
  const re = /`(GET|POST|PATCH|PUT|DELETE)\s+(\/[^`\s?]*)/g;

  let match;
  while ((match = re.exec(markdown)) !== null) {
    const [, method, rawPath] = match;
    // Strip a trailing query string and any trailing punctuation.
    found.add(`${method} ${rawPath.replace(/[.,]$/, '')}`);
  }
  return found;
}

const DOCUMENTED = documentedRoutes(doc);

describe('docs/API.md describes the API that exists (10.8)', () => {
  it('documents every mounted route', () => {
    const missing = ROUTES.map(routeKey).filter((key) => !DOCUMENTED.has(key));

    expect(missing, 'undocumented endpoints').toEqual([]);
  });

  it('documents no route that is not mounted', () => {
    const mounted = new Set(ROUTES.map(routeKey));
    const phantom = [...DOCUMENTED].filter((key) => !mounted.has(key));

    expect(phantom, 'documented but not mounted').toEqual([]);
  });

  it('marks exactly the public routes as public', () => {
    // Each endpoint's row says either "public" or "Bearer"; the public ones must
    // be the same set the audit allows to answer without a token.
    for (const key of PUBLIC_ROUTES.keys()) {
      const [method, routePath] = key.split(' ');
      const row = doc
        .split('\n')
        .find((line) => line.includes(`\`${method} ${routePath}\``) && line.startsWith('|'));

      expect(row, `no table row for ${key}`).toBeTruthy();
      expect(row.toLowerCase(), `${key} is public but not marked so`).toContain('public');
    }
  });

  it('does not claim a public route is authenticated, or the reverse', () => {
    const authenticated = ROUTES.filter((route) => !PUBLIC_ROUTES.has(routeKey(route)));

    // Spot-check the ones most likely to be got wrong: the two that sit on an
    // otherwise-public router.
    for (const key of ['POST /stores/:storeId/save', 'DELETE /stores/:storeId/save']) {
      expect(authenticated.some((route) => routeKey(route) === key)).toBe(true);
      const [method, routePath] = key.split(' ');
      const row = doc
        .split('\n')
        .find((line) => line.includes(`\`${method} ${routePath}\``) && line.startsWith('|'));
      expect(row.toLowerCase()).toContain('bearer');
    }
  });
});

describe('docs/API.md documents the error contract (10.5, 10.8)', () => {
  it('lists every error code the API can produce', async () => {
    const errorsSource = await readFile(path.join(HERE, '..', 'src', 'lib', 'errors.js'), 'utf8');

    // The generic codes are spelled out as string literals in errors.js.
    const codes = [...errorsSource.matchAll(/'([A-Z_]{4,})'/g)].map((match) => match[1]);
    const undocumented = [...new Set(codes)].filter((code) => !doc.includes(code));

    expect(undocumented, 'codes in errors.js but not in API.md').toEqual([]);
  });

  it('documents the codes the error handler adds for rejected bodies', () => {
    for (const code of ['PAYLOAD_TOO_LARGE', 'MALFORMED_JSON', 'UNSUPPORTED_MEDIA_TYPE']) {
      expect(doc).toContain(code);
    }
  });

  it('states the ownership rule', () => {
    expect(doc).toMatch(/404[^.]*never 403|never 403/i);
  });

  it('documents every rate-limit env var that exists', async () => {
    const envSource = await readFile(path.join(HERE, '..', 'src', 'config', 'env.js'), 'utf8');
    const limits = [...envSource.matchAll(/(\w*RATE_LIMIT\w*|JSON_BODY_LIMIT)\s*:/g)].map(
      (match) => match[1],
    );

    for (const name of new Set(limits)) {
      if (name === 'RATE_LIMIT_WINDOW_MS') continue; // the window, not a bucket
      expect(doc, `${name} is not documented`).toContain(name);
    }
  });
});
