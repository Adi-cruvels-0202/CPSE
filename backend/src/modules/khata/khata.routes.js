import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import * as controller from './khata.controller.js';
import {
  khataAccountParams,
  khataAccountQuery,
  khataStatementQuery,
} from './khata.schemas.js';

/**
 * Khata — checklist 9.6 – 9.9.
 *
 * GET only. Checklist 9.9 is "strictly read-only for customers — no write
 * endpoints at all", and this file is where that is true or not: there is no
 * post, patch, put or delete here, so a write attempt falls through to the
 * 404 handler. RLS and the immutability trigger back it up in the database.
 */
export const khataRouter = Router();

khataRouter.use(requireAuth);

khataRouter.get('/', controller.listAccounts);

khataRouter.get(
  '/:accountId',
  validate({ params: khataAccountParams, query: khataAccountQuery }),
  controller.getAccount,
);

khataRouter.get(
  '/:accountId/statement',
  validate({ params: khataAccountParams, query: khataStatementQuery }),
  controller.getStatement,
);
