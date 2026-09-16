import { describe, it, expect } from 'vitest';
import { api, url } from './helpers/app.js';

describe('GET /api/v1/health', () => {
  it('reports the service as healthy', async () => {
    const res = await api().get(url('/health'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.service).toBe('cpse-backend');
    expect(res.body.data.environment).toBe('test');
    expect(typeof res.body.data.uptimeSeconds).toBe('number');
  });

  it('echoes a client-supplied request id', async () => {
    const res = await api().get(url('/health')).set('X-Request-Id', 'req-abc-123');
    expect(res.headers['x-request-id']).toBe('req-abc-123');
  });

  it('generates a request id when the client does not send one', async () => {
    const res = await api().get(url('/health'));
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('does not advertise the server framework', async () => {
    const res = await api().get(url('/health'));
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
