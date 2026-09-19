import { z } from 'zod';

export const khataAccountParams = z
  .object({ accountId: z.string().uuid('Not a valid khata account.') })
  .strict();

/** Checklist 9.7. The transaction list inside an account view is paginated. */
export const khataAccountQuery = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

/**
 * Checklist 9.8. A statement is a period: `from` and `to` are optional, and
 * omitting both gives the account's whole history. Dates are ISO strings,
 * validated here so a malformed one is a 422 rather than a Postgres error.
 */
export const khataStatementQuery = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'The statement period ends before it starts.',
    path: ['to'],
  });
