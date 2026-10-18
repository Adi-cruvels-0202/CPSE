import { Router } from 'express';
import { z } from 'zod';
import { ownStore, storeIdParams, uuid, respond } from '../../lib/merchantRoute.js';
import { receiveDocument } from '../../lib/documentUpload.js';
import { emptyBody } from '../../lib/schemas.js';
import * as verification from './verification.service.js';

/** /merchant/stores/:storeId/verification — the store's KYC (migration 0039). */
export const merchantVerificationRouter = Router();

const detailsSchema = z
  .object({
    legalName: z.string().trim().min(2).max(200).nullable().optional(),
    businessType: z
      .enum(['individual', 'proprietorship', 'partnership', 'llp', 'private_limited', 'public_limited', 'other'])
      .nullable()
      .optional(),
    gstApplicable: z.boolean().optional(),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN.')
      .nullable()
      .optional(),
    ownerName: z.string().trim().min(2).max(120).nullable().optional(),
    ownerPhone: z.string().trim().regex(/^\+?[0-9]{7,15}$/, 'Enter a valid phone number.').nullable().optional(),
    ownerEmail: z.string().trim().email().max(254).nullable().optional(),
    businessAddress: z
      .object({
        line1: z.string().trim().min(1).max(200),
        line2: z.string().trim().max(200).nullable().optional(),
        city: z.string().trim().min(1).max(100),
        state: z.string().trim().min(1).max(100),
        postalCode: z.string().trim().min(3).max(12),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

const docParams = storeIdParams({ docType: z.enum(verification.DOC_TYPES) });
const documentParams = storeIdParams({ documentId: uuid('document') });

merchantVerificationRouter.get(
  '/:storeId/verification',
  ...ownStore(),
  respond(async (req) => ({ verification: await verification.verificationView(req.store.id) })),
);

merchantVerificationRouter.put(
  '/:storeId/verification',
  ...ownStore({ body: detailsSchema }),
  respond(async (req) => ({ verification: await verification.saveDetails(req.store, req.body) })),
);

merchantVerificationRouter.post(
  '/:storeId/verification/documents/:docType',
  ...ownStore({ params: docParams, write: true }),
  receiveDocument,
  respond(
    async (req) => ({ verification: await verification.addDocument(req.store, req.merchant, req.params.docType, req.file) }),
    { created: true },
  ),
);

merchantVerificationRouter.delete(
  '/:storeId/verification/documents/:documentId',
  ...ownStore({ params: documentParams }),
  respond(async (req) => ({ verification: await verification.removeDocumentFromStore(req.store, req.params.documentId) })),
);

merchantVerificationRouter.get(
  '/:storeId/verification/documents/:documentId/url',
  ...ownStore({ params: documentParams }),
  respond(async (req) => verification.documentUrl(req.store.id, req.params.documentId)),
);

merchantVerificationRouter.post(
  '/:storeId/verification/submit',
  ...ownStore({ body: emptyBody, write: true }),
  respond(async (req) => ({ verification: await verification.submit(req.store, req.merchant) })),
);
