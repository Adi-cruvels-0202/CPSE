/**
 * The vision-model wrapper (src/lib/ai.js) with the Gemini SDK mocked: which
 * model is tried, when it falls back, and what the caller sees on failure.
 * No network.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import sharp from 'sharp';

const generateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function GoogleGenAI() {
    this.models = { generateContent };
  }),
}));

process.env.AI_PROVIDER = 'gemini';
process.env.AI_MODEL = 'model-a';
process.env.AI_FALLBACK_MODEL = 'model-b';
process.env.AI_TIMEOUT_MS = '2000';
const ai = await import('../src/lib/ai.js');

const photo = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#c84' } }).png().toBuffer();
const ask = async () => ai.askVision({ file: await ai.filePart(photo), prompt: 'what is it', schema: { type: 'OBJECT' } });

beforeEach(() => {
  generateContent.mockReset();
  ai.setVisionProviderForTests(null);
});

describe('askVision', () => {
  it('sends a shrunk JPEG and the schema, and returns the parsed JSON', async () => {
    generateContent.mockResolvedValue({ text: '{"name":"Salt"}' });
    expect(await ask()).toEqual({ name: 'Salt' });
    const [request] = generateContent.mock.calls[0];
    expect(request.model).toBe('model-a');
    expect(request.config).toMatchObject({ responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' }, temperature: 0 });
    const image = request.contents[0].parts[0].inlineData;
    expect(image.mimeType).toBe('image/jpeg');
    const meta = await sharp(Buffer.from(image.data, 'base64')).metadata();
    expect(Math.max(meta.width, meta.height)).toBe(1280);
  });

  it('falls back to the second model when the first is busy', async () => {
    generateContent.mockRejectedValueOnce(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}')).mockResolvedValueOnce({ text: '{"ok":true}' });
    expect(await ask()).toEqual({ ok: true });
    expect(generateContent.mock.calls.map(([r]) => r.model)).toEqual(['model-a', 'model-b']);
  });

  it('reports busy as 503 AI_UNAVAILABLE when both models fail', async () => {
    generateContent.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED'));
    await expect(ask()).rejects.toMatchObject({ statusCode: 503, code: 'AI_UNAVAILABLE', message: expect.stringMatching(/busy/) });
  });

  it('does not retry a refusal (for example a bad key)', async () => {
    generateContent.mockRejectedValue(new Error('400 API key not valid'));
    await expect(ask()).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', message: expect.stringMatching(/refused/) });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('gives up on a slow model after the timeout', async () => {
    generateContent.mockReturnValue(new Promise(() => {}));
    await expect(ask()).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(generateContent).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('treats non-JSON output as 502 AI_BAD_RESPONSE', async () => {
    generateContent.mockResolvedValue({ text: 'I think it is salt' });
    await expect(ask()).rejects.toMatchObject({ statusCode: 502, code: 'AI_BAD_RESPONSE' });
  });
});

describe('filePart', () => {
  it('passes PDFs only where allowed and rejects unreadable images', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%%EOF\n');
    expect((await ai.filePart(pdf, { allowPdf: true })).mimeType).toBe('application/pdf');
    await expect(ai.filePart(pdf)).rejects.toMatchObject({ code: 'IMAGE_INVALID' });
    await expect(ai.filePart(Buffer.from('garbage'))).rejects.toMatchObject({ statusCode: 422, code: 'IMAGE_INVALID' });
  });
});
