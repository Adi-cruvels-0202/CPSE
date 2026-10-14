import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

/**
 * The one place the app talks to a vision model (roadmap Phase D "Product
 * recognition", "Invoice extraction" from documents). It answers questions
 * about an image or PDF with JSON that matches a schema, and nothing else:
 * callers validate the JSON, match it to the shop's own data and only ever
 * PROPOSE — no model output is written anywhere without a person confirming.
 *
 * Provider: Google Gemini (Developer API) when AI_PROVIDER=gemini and
 * GEMINI_API_KEY is set; otherwise the features report themselves unavailable
 * and the manual forms keep working. Tests replace the provider with
 * setVisionProviderForTests().
 */

export const aiUnavailable = (why) =>
  new AppError(503, 'AI_UNAVAILABLE', `Reading photos is not available right now${why ? ` (${why})` : ''}. Fill the form in by hand.`);

export const aiConfigured = () => env.AI_PROVIDER === 'gemini' && Boolean(env.GEMINI_API_KEY);

let testProvider = null;
/** Tests only: `async ({ parts, schema, model }) => object` (or throw). Pass null to reset. */
export function setVisionProviderForTests(provider) {
  testProvider = provider;
}

let client = null;
const gemini = () => (client ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }));

/**
 * A photo as the model should see it: upright, at most 1280 px, JPEG. Smaller
 * is faster and cheaper, and the EXIF data (location, device) never leaves.
 */
export async function prepareImage(buffer) {
  try {
    const data = await sharp(buffer, { limitInputPixels: 80_000_000 })
      .rotate()
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { mimeType: 'image/jpeg', data };
  } catch {
    throw new AppError(422, 'IMAGE_INVALID', 'That photo could not be read. Try a JPEG or PNG.');
  }
}

const isPdf = (buffer) => buffer?.length > 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';

/** An uploaded file → a part the model can read (images are shrunk; PDFs go as they are). */
export async function filePart(buffer, { allowPdf = false } = {}) {
  if (isPdf(buffer)) {
    if (!allowPdf) throw new AppError(422, 'IMAGE_INVALID', 'Upload a photo (JPEG, PNG or WebP), not a PDF.');
    return { mimeType: 'application/pdf', data: buffer };
  }
  return prepareImage(buffer);
}

const transient = (error) => /\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|timed out/i.test(String(error?.message ?? error));

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Asks the model about one file and returns the parsed JSON (not yet
 * validated — the caller's schema check does that). One retry on the
 * fallback model when the first is busy or slow.
 */
export async function askVision({ file, prompt, schema }) {
  const parts = [{ inlineData: { mimeType: file.mimeType, data: file.data.toString('base64') } }, { text: prompt }];
  if (testProvider) return testProvider({ parts, schema, model: env.AI_MODEL });
  if (!aiConfigured()) throw aiUnavailable(env.AI_PROVIDER === 'none' ? 'no AI provider is configured' : 'the API key is missing');

  const models = [env.AI_MODEL, env.AI_FALLBACK_MODEL].filter((m, i, all) => m && all.indexOf(m) === i);
  let lastError = null;
  for (const model of models) {
    try {
      const response = await withTimeout(
        gemini().models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 },
        }),
        env.AI_TIMEOUT_MS,
      );
      const text = response.text ?? '';
      try {
        return JSON.parse(text);
      } catch {
        throw new AppError(502, 'AI_BAD_RESPONSE', 'The photo reader returned something unreadable. Try again, or fill the form in by hand.');
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      lastError = error;
      logger.warn('vision model call failed', { model, reason: String(error.message).slice(0, 200) });
      if (!transient(error)) break;
    }
  }
  throw aiUnavailable(transient(lastError) ? 'the photo reader is busy — try again in a minute' : 'the photo reader refused the request');
}
