import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../src/middleware/validate.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { requestContext } from '../src/middleware/requestContext.js';

function buildApp(schemas) {
  const app = express();
  app.use(requestContext);
  app.use(express.json());
  app.post('/items/:id', validate(schemas), (req, res) => {
    res.json({ params: req.params, query: req.query, body: req.body });
  });
  app.use(errorHandler);
  return request(app);
}

const schemas = {
  params: z.object({ id: z.string().uuid() }),
  query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
  body: z.object({ quantity: z.number().int().min(1).max(99) }).strict(),
};

const VALID_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('validate middleware', () => {
  it('passes valid requests through and coerces values', async () => {
    const res = await buildApp(schemas)
      .post(`/items/${VALID_ID}?page=3`)
      .send({ quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body.params.id).toBe(VALID_ID);
    expect(res.body.query.page).toBe(3); // coerced from the string '3'
    expect(res.body.body.quantity).toBe(2);
  });

  it('applies schema defaults when a value is absent', async () => {
    const res = await buildApp(schemas).post(`/items/${VALID_ID}`).send({ quantity: 1 });
    expect(res.body.query.page).toBe(1);
  });

  it('rejects an invalid identifier with 422 and names the field', async () => {
    const res = await buildApp(schemas).post('/items/not-a-uuid').send({ quantity: 1 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.issues).toContainEqual(
      expect.objectContaining({ source: 'params', field: 'id' }),
    );
  });

  it('rejects an invalid quantity', async () => {
    const res = await buildApp(schemas).post(`/items/${VALID_ID}`).send({ quantity: 0 });

    expect(res.status).toBe(422);
    expect(res.body.error.details.issues).toContainEqual(
      expect.objectContaining({ source: 'body', field: 'quantity' }),
    );
  });

  it('collects issues from every source in one response', async () => {
    const res = await buildApp(schemas).post('/items/bad?page=0').send({ quantity: 500 });

    expect(res.status).toBe(422);
    const sources = res.body.error.details.issues.map((issue) => issue.source);
    expect(new Set(sources)).toEqual(new Set(['params', 'query', 'body']));
  });

  it('strips unknown body keys rather than trusting them', async () => {
    const lenient = { body: z.object({ quantity: z.number().int() }) };
    const res = await buildApp(lenient).post(`/items/${VALID_ID}`).send({
      quantity: 1,
      isAdmin: true,
      price: 0,
    });

    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ quantity: 1 });
  });
});
