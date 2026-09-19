import { z } from 'zod';

/** Checklist 9.4. Same pagination contract as every other list endpoint. */
export const notificationListQuery = z
  .object({
    unreadOnly: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export const notificationParams = z
  .object({ id: z.string().uuid('Not a valid notification.') })
  .strict();
