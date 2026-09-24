import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import express from 'express';

import { env } from '../config/env.js';
import { API_PREFIX } from '../app.js';
import { logger } from './logger.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(HERE, '../../../frontend');
const DIST_DIR = path.join(FRONTEND_DIR, 'dist');

/** Kept so shutdown can close Vite's watchers and HMR socket. */
let viteServer = null;

/**
 * Anything under the API prefix belongs to the API — and by the time a request
 * reaches this router the API has already declined it, so it is a genuine 404
 * and must get the JSON error envelope rather than the app shell. `next('router')`
 * leaves this router entirely and lands on the app's notFoundHandler.
 */
function apiRequestsPassThrough(req, res, next) {
  if (req.path === API_PREFIX || req.path.startsWith(`${API_PREFIX}/`)) return next('router');
  return next();
}

/**
 * Development: run Vite inside this process, in middleware mode.
 *
 * Vite is resolved out of `frontend/node_modules` rather than being a backend
 * dependency — it is the frontend's build tool and stays versioned with the
 * frontend. Nothing is built ahead of time: Vite transforms each module as the
 * browser asks for it and pushes HMR updates over the API server's own HTTP
 * server, so an edit to a `.jsx` file shows up without a rebuild or a restart.
 */
async function mountDevServer(router, httpServer) {
  const requireFromFrontend = createRequire(path.join(FRONTEND_DIR, 'package.json'));
  // Resolve the package, then its ESM entry by hand: plain `resolve('vite')`
  // hands back the CJS build, whose named exports Node cannot see from here.
  const viteDir = path.dirname(requireFromFrontend.resolve('vite/package.json'));
  const esmEntry = path.join(viteDir, 'dist/node/index.js');
  const entry = fs.existsSync(esmEntry) ? esmEntry : requireFromFrontend.resolve('vite');
  const vite = await import(pathToFileURL(entry).href);
  const createServer = vite.createServer ?? vite.default?.createServer;

  viteServer = await createServer({
    root: FRONTEND_DIR,
    configFile: path.join(FRONTEND_DIR, 'vite.config.js'),
    // 'spa' is what makes Vite's own middleware stack serve and transform
    // index.html, including the deep-link fallback React Router needs.
    appType: 'spa',
    server: {
      middlewareMode: true,
      // Share the API server's socket so HMR needs no second port and no
      // second origin — which is the whole point of this setup.
      hmr: httpServer ? { server: httpServer } : true,
    },
  });

  router.use(viteServer.middlewares);
  logger.info('frontend mounted (vite dev middleware)', { root: FRONTEND_DIR });
}

/**
 * Production: serve the build output. `npm run build` in the backend produces
 * it; without it there is nothing to serve, and saying so plainly beats
 * answering every page request with a 404.
 */
function mountBuiltApp(router) {
  const indexHtml = path.join(DIST_DIR, 'index.html');

  if (!fs.existsSync(indexHtml)) {
    logger.warn('frontend build missing — API only', { expected: indexHtml });
    return;
  }

  // Vite fingerprints everything in assets/, so those are safe to cache hard.
  router.use(
    '/assets',
    express.static(path.join(DIST_DIR, 'assets'), { immutable: true, maxAge: '1y' }),
  );
  // Everything else (favicon, public/) is unhashed, so it revalidates.
  router.use(express.static(DIST_DIR, { index: false }));
  // Deep links: /store/blue-mart is a client-side route, not a file.
  router.get('*', (req, res) => res.sendFile(indexHtml));

  logger.info('frontend mounted (static build)', { dist: DIST_DIR });
}

/**
 * Attaches the frontend to the router `createApp` reserved for it, so one
 * process on one port serves both the API and the app.
 */
export async function mountFrontend(app, httpServer) {
  if (!env.SERVE_FRONTEND) {
    logger.info('frontend hosting disabled (SERVE_FRONTEND=false)');
    return;
  }

  const router = app.locals.frontendRouter;
  if (!router) throw new Error('createApp() did not reserve a frontend router.');

  router.use(apiRequestsPassThrough);

  if (env.isProduction) {
    mountBuiltApp(router);
  } else {
    await mountDevServer(router, httpServer);
  }
}

/** Closes Vite's file watchers; a no-op in production. */
export async function closeFrontend() {
  if (!viteServer) return;
  await viteServer.close();
  viteServer = null;
}
