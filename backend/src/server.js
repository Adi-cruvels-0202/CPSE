import http from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { mountFrontend, closeFrontend } from './lib/frontendHost.js';

const app = createApp();

// The HTTP server is created explicitly rather than via app.listen() so Vite's
// HMR socket can share it — one port serves the API, the app and hot reloads.
const server = http.createServer(app);

await mountFrontend(app, server);

server.listen(env.PORT, () => {
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
