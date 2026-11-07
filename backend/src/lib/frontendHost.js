import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import express from 'express';

import { env } from '../config/env.js';
import { API_PREFIX } from '../app.js';
import { logger } from './logger.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(HERE, '../../../frontend');

/**
 * The three customer/merchant app entry points served beside the API, on the same port and
 * origin — so they share one login (the session in localStorage) and the API
 * needs no CORS:
 *
 *   /           the customer app   frontend/customer  (React + Vite)
 *   /merchant/  the merchant app   frontend/merchant  (React + TS + Vite, base '/merchant/')
 *
 * The merchant app is mounted first: the customer app's deep-link fallback
 * answers every unknown path with its own index.html, and would swallow
 * /merchant/* otherwise.
 */
const APPS = [
  {
    name: 'redesign-v2',
    dir: path.resolve(FRONTEND_ROOT, '../frontend-redesign-v2'),
    config: 'vite.config.ts',
    base: '/v2',
    hmrPort: 24681,
    output: 'nitro-middleware',
  },
  {
    name: 'merchant',
    dir: path.join(FRONTEND_ROOT, 'merchant'),
    config: 'vite.config.ts',
    base: '/merchant',
    // Its own HMR port in development: two Vite servers both upgrading
    // WebSockets on the API's socket would fight over each connection.
    hmrPort: 24679,
  },
  {
    name: 'customer',
    dir: path.join(FRONTEND_ROOT, 'customer'),
    config: 'vite.config.js',
    base: '',
    hmrPort: null,
  },
];

/** Kept so shutdown can close Vite's watchers and HMR sockets. */
const viteServers = [];

/**
 * Anything under the API prefix belongs to the API — and by the time a request
 * reaches this router the API has already declined it, so it is a genuine 404
 * and must get the JSON error envelope rather than an app shell. `next('router')`
 * leaves this router entirely and lands on the app's notFoundHandler.
 */
function apiRequestsPassThrough(req, res, next) {
  if (req.path === API_PREFIX || req.path.startsWith(`${API_PREFIX}/`)) return next('router');
  return next();
}

/** Does this request belong to the app mounted at `base`? '' takes everything left. */
const belongsTo = (base) => (req) => base === '' || req.path === base || req.path.startsWith(`${base}/`);

/**
 * Development: run each app's Vite inside this process, in middleware mode.
 *
 * Vite is resolved out of the app's own node_modules rather than being a
 * backend dependency — it is the frontend's build tool and stays versioned with
 * it (the two apps need not even share a Vite version). Nothing is built ahead
 * of time: Vite transforms each module as the browser asks for it and pushes
 * HMR updates, so an edit to a component shows up without a rebuild.
 */
async function mountDevServer(router, httpServer, app) {
  if (!fs.existsSync(path.join(app.dir, 'node_modules'))) {
    logger.warn(`${app.name} app not installed — run npm install in ${app.dir}`);
    return;
  }

  const requireFromApp = createRequire(path.join(app.dir, 'package.json'));
  // Resolve the package, then its ESM entry by hand: plain `resolve('vite')`
  // hands back the CJS build, whose named exports Node cannot see from here.
  const viteDir = path.dirname(requireFromApp.resolve('vite/package.json'));
  const esmEntry = path.join(viteDir, 'dist/node/index.js');
  const entry = fs.existsSync(esmEntry) ? esmEntry : requireFromApp.resolve('vite');
  const vite = await import(pathToFileURL(entry).href);
  const createServer = vite.createServer ?? vite.default?.createServer;

  const server = await createServer({
    root: app.dir,
    configFile: path.join(app.dir, app.config),
    // TanStack's SSR request runner resolves source imports independently of
    // the browser transform pipeline, so define the app's @/ alias explicitly.
    resolve: { alias: { '@': path.join(app.dir, 'src') } },
    // TanStack Start installs its own request handler in middleware mode;
    // React SPAs use Vite's HTML fallback and index transformation instead.
    appType: app.output === 'nitro-middleware' ? 'custom' : 'spa',
    server: {
      middlewareMode: true,
      hmr: app.hmrPort ? { port: app.hmrPort } : httpServer ? { server: httpServer } : true,
    },
  });
  viteServers.push(server);

  // Not `router.use(base, …)`: that strips the prefix, and Vite (configured
  // with `base`) expects to see the full URL.
  const owns = belongsTo(app.base);
  router.use((req, res, next) => (owns(req) ? server.middlewares(req, res, next) : next()));
  logger.info(`${app.name} app mounted (vite dev middleware)`, { root: app.dir, at: app.base || '/' });
}

/**
 * Production: serve each app's build output. `npm run build` in the backend
 * produces both; an app without one is reported plainly rather than answering
 * every page with a 404.
 */
async function mountBuiltMiddlewareApp(router, app) {
  const outputDir = path.join(app.dir, '.output');
  const publicDir = path.join(outputDir, 'public');
  const serverEntry = path.join(outputDir, 'server/index.mjs');

  if (!fs.existsSync(serverEntry)) {
    logger.warn(`${app.name} app build missing`, { expected: serverEntry });
    return;
  }

  const { middleware } = await import(pathToFileURL(serverEntry).href);
  if (typeof middleware !== 'function') {
    throw new Error(`${app.name} build does not export a Node middleware handler.`);
  }

  // Serve fingerprinted assets and public files, then let the TanStack Start
  // Fetch handler render /v2 and its client-side routes through this process.
  if (fs.existsSync(publicDir)) {
    const assetsDir = path.join(publicDir, 'assets');
    if (fs.existsSync(assetsDir)) {
      router.use(`${app.base}/assets`, express.static(assetsDir, { immutable: true, maxAge: '1y' }));
    }
    router.use(app.base, express.static(publicDir, { index: false }));
  }
  const owns = belongsTo(app.base);
  router.use((req, res, next) => {
    if (!owns(req)) return next();
    const nonce = res.locals?.cspNonce;
    if (nonce) req.headers['x-cpse-csp-nonce'] = nonce;
    return middleware(req, res, next);
  });
  logger.info(`${app.name} app mounted (Node middleware build)`, { outputDir, at: app.base });
}

function mountBuiltApp(router, app) {
  const dist = path.join(app.dir, 'dist');
  const indexHtml = path.join(dist, 'index.html');

  if (!fs.existsSync(indexHtml)) {
    logger.warn(`${app.name} app build missing`, { expected: indexHtml });
    return;
  }

  const at = (suffix) => `${app.base}${suffix}`;
  // Vite fingerprints everything in assets/, so those are safe to cache hard.
  router.use(at('/assets'), express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
  // Everything else (favicon, public/) is unhashed, so it revalidates.
  router.use(app.base || '/', express.static(dist, { index: false }));
  // Deep links: /store/blue-mart and /merchant/orders are client-side routes.
  const owns = belongsTo(app.base);
  router.get('*', (req, res, next) => (owns(req) ? res.sendFile(indexHtml) : next()));

  logger.info(`${app.name} app mounted (static build)`, { dist, at: app.base || '/' });
}

/**
 * Attaches both apps to the router `createApp` reserved for them, so one
 * process on one port serves the API and the apps.
 */
export async function mountFrontend(app, httpServer) {
  if (!env.SERVE_FRONTEND) {
    logger.info('frontend hosting disabled (SERVE_FRONTEND=false)');
    return;
  }

  const router = app.locals.frontendRouter;
  if (!router) throw new Error('createApp() did not reserve a frontend router.');

  router.use(apiRequestsPassThrough);

  for (const frontend of APPS) {
    if (env.isProduction || env.SERVE_STATIC_FRONTEND) {
      if (frontend.output === 'nitro-middleware') {
        await mountBuiltMiddlewareApp(router, frontend);
      } else {
        mountBuiltApp(router, frontend);
      }
    } else {
      await mountDevServer(router, httpServer, frontend);
    }
  }
}

/** Closes every Vite's file watchers; a no-op in production. */
export async function closeFrontend() {
  await Promise.all(viteServers.splice(0).map((server) => server.close()));
}
