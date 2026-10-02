import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { api, http, ApiError, errorMessage } from '../src/api/client';
import { readSession, writeSession } from '../src/lib/session';

/**
 * The API client against a fake transport: no server, the same envelopes the
 * backend sends (backend docs/API.md).
 */

type Handler = (config: any) => { status: number; data?: any };

function respondWith(handler: Handler) {
  const adapter = vi.fn(async (config: any) => {
    const { status, data } = handler(config);
    const response = { status, data, headers: {}, config, statusText: String(status) };
    if (status >= 400) {
      const error: any = new Error(`Request failed with status code ${status}`);
      error.response = response;
      error.config = config;
      error.isAxiosError = true;
      throw error;
    }
    return response;
  });
  // The client's own instance, and the global one its refresh call uses.
  http.defaults.adapter = adapter as any;
  axios.defaults.adapter = adapter as any;
  return adapter;
}

beforeEach(() => window.localStorage.clear());

describe('the API client', () => {
  it('unwraps the envelope and sends the bearer token', async () => {
    writeSession({ accessToken: 'token-1', refreshToken: 'refresh-1' });
    const adapter = respondWith(() => ({ status: 200, data: { success: true, data: { stores: [] } } }));

    await expect(api.get('/merchant/stores')).resolves.toEqual({ stores: [] });
    expect(adapter.mock.calls[0][0].headers.Authorization).toBe('Bearer token-1');
  });

  it('turns an error envelope into an ApiError with the server’s words', async () => {
    respondWith(() => ({
      status: 422,
      data: { success: false, error: { code: 'INSUFFICIENT_STOCK', message: 'Only 2 can be sold.', details: { availableQuantity: 2 } }, requestId: 'r-1' },
    }));

    const error = await api.post('/x', {}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: 'INSUFFICIENT_STOCK', message: 'Only 2 can be sold.', requestId: 'r-1' });
    expect(error.details.availableQuantity).toBe(2);
  });

  it('shows the first field’s reason for a validation failure', () => {
    const error = new ApiError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed.',
      details: { issues: [{ source: 'body', field: 'pricePaise', message: 'Use whole paise.' }] },
    });
    expect(errorMessage(error)).toBe('Use whole paise.');
  });

  it('refreshes an expired session once and replays the request', async () => {
    writeSession({ accessToken: 'old', refreshToken: 'refresh-1' });
    respondWith((config) => {
      if (config.url.endsWith('/auth/refresh')) {
        return { status: 200, data: { success: true, data: { session: { accessToken: 'new', refreshToken: 'refresh-2', expiresAt: 9 } } } };
      }
      return config.headers.Authorization === 'Bearer new'
        ? { status: 200, data: { success: true, data: { ok: true } } }
        : { status: 401, data: { success: false, error: { code: 'UNAUTHORIZED', message: 'Expired.' } } };
    });

    await expect(api.get('/merchant/me')).resolves.toEqual({ ok: true });
    expect(readSession()).toMatchObject({ accessToken: 'new', refreshToken: 'refresh-2' });
  });

  it('signs out when the refresh is refused too', async () => {
    writeSession({ accessToken: 'old', refreshToken: 'dead' });
    respondWith(() => ({ status: 401, data: { success: false, error: { code: 'UNAUTHORIZED', message: 'No.' } } }));

    await expect(api.get('/merchant/me')).rejects.toMatchObject({ status: 401 });
    expect(readSession()).toBeNull();
  });

  it('calls a dropped connection a network problem, not a server one', async () => {
    http.defaults.adapter = (async (config: any) => {
      const error: any = new Error('Network Error');
      error.config = config;
      error.isAxiosError = true;
      throw error;
    }) as any;

    await expect(api.get('/merchant/me')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});
