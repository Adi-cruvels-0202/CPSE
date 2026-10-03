import http from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { mountFrontend, closeFrontend } from './lib/frontendHost.js';

const app = createApp();

// The HTTP server is created explicitly rather than via app.listen() so Vite's
// HMR socket can share it — one port serves the API, the app and hot reloads.
const server = http.createServer(app);

// The port is claimed before Vite starts. A second `npm run dev` used to start
// both Vite servers first and only then fail to listen — and dying mid-way
// through a dependency pre-bundle left the running server's
// node_modules/.vite cache half-deleted, so its pages loaded blank.
server.once('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  logger.error(`port ${env.PORT} is already in use — is another \`npm run dev\` running?`);
  process.exit(1);
});

server.listen(env.PORT, async () => {
  await mountFrontend(app, server);
  logger.info('server started', {
    port: env.PORT,
    environment: env.NODE_ENV,
    url: `http://localhost:${env.PORT}`,
  });
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });
  // Vite holds file watchers open; without this, --watch restarts leak them.
  closeFrontend().finally(() => server.close(() => process.exit(0)));
  // Don't let a hung connection block the exit forever.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled promise rejection', { reason: String(reason) });
});

process.on('uncaughtException', (error) => {
  logger.error('uncaught exception', { errorMessage: error.message, stack: error.stack });
  shutdown('uncaughtException');
});
