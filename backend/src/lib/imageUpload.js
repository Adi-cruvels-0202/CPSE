import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { supabaseAdmin } from './supabase.js';
import { AppError, internal, unprocessable } from './errors.js';
import { logger } from './logger.js';

/**
 * Photo uploads — store logos, covers and product images (D-10, MERCHANT_RULES
 * S-17). Files go to Supabase Storage, not this server's disk, which would not
 * survive a redeploy.
 *
 * What is checked, and why it is not just the file name:
 *   - size ≤ 5 MB, enforced while the file streams in;
 *   - the type is read from the file's own first bytes (JPEG, PNG or WebP).
 *     The client's Content-Type and extension are only claims; a renamed .exe
 *     or an HTML page called photo.png is refused here;
 *   - the stored name is a fresh UUID, so a client-chosen name can never
 *     traverse paths or overwrite another file.
 *
 * The bucket (migration 0033) repeats the size and type limits, behind these.
 */

export const IMAGE_BUCKET = 'catalogue';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
}).single('file');

/**
 * Express middleware: puts the one uploaded file on `req.file`, or refuses the
 * request with the API's own error envelope.
 */
export function receiveImage(req, res, next) {
  upload(req, res, (error) => {
    if (!error) {
      if (!req.file) {
        return next(
          unprocessable('IMAGE_REQUIRED', 'Choose a photo to upload.', {
            issues: [{ source: 'body', field: 'file', message: 'Send the photo as a multipart field named "file".' }],
          }),
        );
      }
      return next();
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(413, 'PAYLOAD_TOO_LARGE', 'Photos can be at most 5 MB.'));
    }
    if (error instanceof multer.MulterError) {
      return next(
        unprocessable('IMAGE_REQUIRED', 'Send exactly one photo, as a multipart field named "file".', {
          issues: [{ source: 'body', field: error.field ?? 'file', message: error.message }],
        }),
      );
    }
    return next(error);
  });
}

/** The real type of the bytes, or null — never what the client said it was. */
export function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/**
 * Stores the photo under `folder` and answers its public URL. `folder` is built
 * by the caller from ids it has already checked the merchant owns.
 */
export async function storeImage(file, folder) {
  const type = sniffImageType(file.buffer);
  if (!type) {
    throw unprocessable('IMAGE_INVALID', 'Use a JPEG, PNG or WebP photo.', {
      issues: [{ source: 'body', field: 'file', message: 'That file is not a JPEG, PNG or WebP image.' }],
    });
  }

  const path = `${folder}/${randomUUID()}.${type.ext}`;
  const { error } = await supabaseAdmin.storage
    .from(IMAGE_BUCKET)
    .upload(path, file.buffer, { contentType: type.mime, upsert: false, cacheControl: '31536000' });

  if (error) {
    logger.error('image upload failed', { message: error.message, path });
    throw internal('Could not save the photo.');
  }

  return supabaseAdmin.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Deletes a photo this app stored, given its public URL. A URL pointing
 * anywhere else (a link the merchant pasted, a seed image) is left alone, and a
 * failed delete only costs storage, so it is logged rather than thrown.
 */
export async function removeStoredImage(url) {
  if (!url) return;
  const marker = `/storage/v1/object/public/${IMAGE_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return;

  const path = decodeURIComponent(url.slice(at + marker.length));
  const { error } = await supabaseAdmin.storage.from(IMAGE_BUCKET).remove([path]);
  if (error) logger.warn('could not delete a replaced photo', { path, message: error.message });
}
