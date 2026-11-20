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

export interface ImageEditRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  image: GeneratedImage;
  width: number;
  height: number;
  signal?: AbortSignal;
}

/**
 * FLUX.2 editing on Cloudflare: a multipart form with the instruction and the source
 * image, answered with JSON holding the edited image as base64.
 */
export async function editCloudflareImage(
  request: ImageEditRequest,
): Promise<GeneratedImage> {
  const form = new FormData();
  form.append('prompt', request.prompt);
  form.append(
    'input_image_0',
    new Blob([new Uint8Array(request.image.data)], {
      type: request.image.mimeType,
    }),
    'source',
  );
  form.append('width', String(request.width));
  form.append('height', String(request.height));

  const response = await fetch(`${request.baseUrl}/${request.model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${request.apiKey}` },
    body: form,
    signal: request.signal,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new ProviderError(
      `Provider returned ${response.status}: ${detail}`,
      response.status,
    );
  }
  const json = (await response.json()) as {
    result?: { image?: string };
    errors?: Array<{ message?: string }>;
  };
  if (!json.result?.image) {
    throw new ProviderError(
      json.errors?.[0]?.message ?? 'Provider returned no image',
    );
  }
  const data = Buffer.from(json.result.image, 'base64');
  return { data, mimeType: sniffImageType(data) };
}

/**
 * Output size for an edit: about one megapixel in the source's own shape (multiples
 * of 16, sides capped at 2:1), so portraits stay portraits.
 */
export function editOutputSize(source?: { width: number; height: number }) {
  if (!source?.width || !source.height) return { width: 1024, height: 1024 };
  const ratio = Math.min(2, Math.max(0.5, source.width / source.height));
  const height = Math.sqrt((1024 * 1024) / ratio);
  const snap = (n: number) => Math.round(n / 16) * 16;
  return { width: snap(height * ratio), height: snap(height) };
}

/** The listed aspect ratio closest to a size, for display in the library. */
export function nearestAspectRatio(width: number, height: number) {
  const target = width / height;
  return Object.entries(IMAGE_SIZES).reduce((best, [label, size]) =>
    Math.abs(size.width / size.height - target) <
    Math.abs(IMAGE_SIZES[best[0]].width / IMAGE_SIZES[best[0]].height - target)
      ? [label, size]
      : best,
  )[0];
}
