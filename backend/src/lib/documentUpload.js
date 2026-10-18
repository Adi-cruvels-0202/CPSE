import { createHash, randomUUID } from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import { supabaseAdmin } from './supabase.js';
import { AppError, internal, unprocessable } from './errors.js';
import { logger } from './logger.js';
import { sniffImageType } from './imageUpload.js';

/**
 * Sensitive documents — store verification (KYC) proofs. Unlike catalogue
 * photos these go to a PRIVATE bucket (migration 0039): nothing about them is
 * ever a public URL, and they are read back only through short-lived signed
 * URLs handed to the store's owner or a platform reviewer.
 *
 *   - type read from the bytes: JPEG, PNG, WebP or PDF;
 *   - images re-encoded (metadata such as GPS location dropped), kept large
 *     enough to stay legible;
 *   - stored under a random name in a folder built from ids the caller has
 *     already authorised; a SHA-256 of the stored bytes is kept for audit.
 *
 * File contents and names are never logged.
 */

export const KYC_BUCKET = 'kyc';
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const DOCUMENT_MAX_SIDE = 2400;
const SIGNED_URL_SECONDS = 300;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 0 },
}).single('file');

export function receiveDocument(req, res, next) {
  upload(req, res, (error) => {
    if (!error) {
      if (!req.file) {
        return next(
          unprocessable('DOCUMENT_REQUIRED', 'Choose a file to upload.', {
            issues: [{ source: 'body', field: 'file', message: 'Send the document as a multipart field named "file".' }],
          }),
        );
      }
      return next();
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(413, 'PAYLOAD_TOO_LARGE', 'Documents can be at most 5 MB.'));
    }
    if (error instanceof multer.MulterError) {
      return next(unprocessable('DOCUMENT_REQUIRED', 'Send exactly one file, as a multipart field named "file".'));
    }
    return next(error);
  });
}

const isPdf = (buffer) => buffer?.length > 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';

const invalidDocument = () =>
  unprocessable('DOCUMENT_INVALID', 'Upload a JPEG, PNG, WebP or PDF file.', {
    issues: [{ source: 'body', field: 'file', message: 'That file is not a supported image or a PDF.' }],
  });

/** Stores one verification document; returns what the database row needs. */
export async function storeDocument(file, folder) {
  let body;
  let mime;
  if (isPdf(file.buffer)) {
    body = file.buffer;
    mime = 'application/pdf';
  } else if (sniffImageType(file.buffer)) {
    try {
      body = await sharp(file.buffer, { limitInputPixels: 80_000_000 })
        .rotate()
        .resize({ width: DOCUMENT_MAX_SIDE, height: DOCUMENT_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
    } catch {
      throw invalidDocument();
    }
    mime = 'image/webp';
  } else {
    throw invalidDocument();
  }

  const path = `${folder}/${randomUUID()}.${mime === 'application/pdf' ? 'pdf' : 'webp'}`;
  const { error } = await supabaseAdmin.storage
    .from(KYC_BUCKET)
    .upload(path, body, { contentType: mime, upsert: false, cacheControl: 'no-store' });
  if (error) {
    logger.error('verification document upload failed', { message: error.message });
    throw internal('Could not save the document.');
  }

  return {
    storagePath: path,
    mimeType: mime,
    sizeBytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}

/** A link that works for a few minutes, for the owner or a reviewer only. */
export async function signedDocumentUrl(storagePath) {
  const { data, error } = await supabaseAdmin.storage.from(KYC_BUCKET).createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    logger.error('could not sign a verification document url', { message: error?.message });
    throw internal('Could not open the document.');
  }
  return { url: data.signedUrl, expiresInSeconds: SIGNED_URL_SECONDS };
}

export async function removeDocument(storagePath) {
  const { error } = await supabaseAdmin.storage.from(KYC_BUCKET).remove([storagePath]);
  if (error) logger.warn('could not delete a verification document', { message: error.message });
}
