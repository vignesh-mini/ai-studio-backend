import { ProviderError } from './openai-compatible.js';

export interface ImageRequest {
  /** Model run URL, e.g. https://api.cloudflare.com/client/v4/accounts/<id>/ai/run */
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  steps: number;
  width?: number;
  height?: number;
  signal?: AbortSignal;
}

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
}

/**
 * Cloudflare Workers AI text-to-image. Models answer either with JSON
 * (`{ result: { image: <base64> } }`, e.g. FLUX.1 schnell) or with the raw image bytes,
 * so both are handled. Only fields a model's schema accepts are sent, because some
 * schemas reject unknown properties.
 */
export async function generateCloudflareImage(
  request: ImageRequest,
): Promise<GeneratedImage> {
  const body: Record<string, unknown> = {
    prompt: request.prompt,
    steps: request.steps,
  };
  if (request.width && request.height) {
    body.width = request.width;
    body.height = request.height;
  }

  const response = await fetch(`${request.baseUrl}/${request.model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${request.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: request.signal,
  });

  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new ProviderError(
      `Provider returned ${response.status}: ${detail}`,
      response.status,
    );
  }

  if (contentType.startsWith('image/')) {
    return {
      data: Buffer.from(await response.arrayBuffer()),
      mimeType: contentType.split(';')[0],
    };
  }

  const json = (await response.json()) as {
    result?: { image?: string };
    errors?: Array<{ message?: string }>;
  };
  const base64 = json.result?.image;
  if (!base64) {
    throw new ProviderError(
      json.errors?.[0]?.message ?? 'Provider returned no image',
    );
  }
  const data = Buffer.from(base64, 'base64');
  return { data, mimeType: sniffImageType(data) };
}

/** Detects the format from the file signature; base64 responses don't declare it. */
export function sniffImageType(data: Buffer): string {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
  if (data[0] === 0x52 && data[1] === 0x49 && data[8] === 0x57)
    return 'image/webp';
  return 'image/jpeg';
}

/** About one megapixel in the requested shape, in multiples of 64. */
export const IMAGE_SIZES: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1344, height: 768 },
  '9:16': { width: 768, height: 1344 },
  '4:3': { width: 1152, height: 896 },
  '3:4': { width: 896, height: 1152 },
};
