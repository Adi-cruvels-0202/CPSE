import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { api, url } from './helpers/app.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { requestContext } from '../src/middleware/requestContext.js';
import { asyncHandler } from '../src/lib/asyncHandler.js';
import { AppError, notFound, conflict } from '../src/lib/errors.js';

/** Minimal app used to drive the error middleware directly. */
function appThatThrows(error) {
  const app = express();
  app.use(requestContext);
  app.get(
    '/boom',
    asyncHandler(async () => {
      throw error;
    }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);
  return request(app);
}

describe('error handling', () => {
  it('returns a consistent envelope for unknown routes', async () => {
    const res = await api().get(url('/does-not-exist'));

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(res.body.requestId).toBeTruthy();
  });

  it('reports an AppError with its status, code and message', async () => {
    const res = await appThatThrows(notFound('Store')).get('/boom');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Store was not found.');
  });

  it('includes structured details when the error carries them', async () => {
    const error = conflict('Order already exists.', { orderId: 'ord_1' });
    const res = await appThatThrows(error).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ orderId: 'ord_1' });
  });

  it('catches rejected promises from async handlers', async () => {
    const res = await appThatThrows(new AppError(418, 'TEAPOT', 'Nope.')).get('/boom');
    expect(res.status).toBe(418);
    expect(res.body.error.code).toBe('TEAPOT');
  });

  it('never leaks internal details from an unexpected error', async () => {
    const res = await appThatThrows(new Error('connection string: postgres://secret')).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('Something went wrong on our end.');
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(res.body.error.stack).toBeUndefined();
  });
});
