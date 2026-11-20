import { ProviderError } from './openai-compatible.js';

export interface VideoOptions {
  prompt: string;
  durationSec: number;
  aspectRatio: string;
  /** Start frame for image-to-video, as a data URI (fal accepts these directly). */
  imageUrl?: string;
}

export interface FalVideoRequest {
  /** Queue base URL, https://queue.fal.run */
  baseUrl: string;
  apiKey: string;
  endpoint: string;
  input: Record<string, unknown>;
  /** Called with a rough 0–1 progress while the request waits and runs. */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface GeneratedVideo {
  data: Buffer;
  mimeType: string;
}

const POLL_MS = 3000;

/**
 * Maps the app's options onto a fal endpoint and its input schema. The seed stores the
 * text-to-video endpoint; image-to-video lives next to it. Wan runs at 480p, its
 * cheapest tier ($0.04 per video second); LTX costs the same per clip at 720p.
 */
export function falVideoInput(providerModel: string, options: VideoOptions) {
  const endpoint = options.imageUrl
    ? providerModel.endsWith('/text-to-video')
      ? providerModel.replace(/\/text-to-video$/, '/image-to-video')
      : `${providerModel}/image-to-video`
    : providerModel;

  const input: Record<string, unknown> = {
    prompt: options.prompt,
    aspect_ratio: options.aspectRatio,
  };
  if (options.imageUrl) input.image_url = options.imageUrl;

  if (providerModel.includes('/wan/')) {
    // Wan generates 16 fps and accepts 17–161 frames.
    input.frames_per_second = 16;
    input.num_frames = Math.min(
      161,
      Math.max(17, options.durationSec * 16 + 1),
    );
    input.resolution = '480p';
  } else {
    input.frame_rate = 24;
    input.num_frames = options.durationSec * 24 + 1;
    input.resolution = '720p';
  }
  return { endpoint, input };
}

/**
 * fal's queue API: submit, poll the status URL it returns, then fetch the result and
 * download the video. Uses the returned URLs as-is, because nested endpoints such as
 * `fal-ai/wan/v2.2-a14b/text-to-video` are polled under a shorter app path.
 */
export async function generateFalVideo(
  request: FalVideoRequest,
): Promise<GeneratedVideo> {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Key ${request.apiKey}`,
  };
  const submitted = await falJson<{
    status_url: string;
    response_url: string;
  }>(`${request.baseUrl}/${request.endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request.input),
    signal: request.signal,
  });

  let progress = 0.1;
  for (;;) {
    const status = await falJson<{ status: string }>(submitted.status_url, {
      headers,
      signal: request.signal,
    });
    if (status.status === 'COMPLETED') break;
    if (status.status === 'IN_PROGRESS')
      progress = Math.min(0.9, progress + 0.03);
    request.onProgress?.(progress);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    request.signal?.throwIfAborted();
  }

  const result = await falJson<{ video?: { url?: string } }>(
    submitted.response_url,
    { headers, signal: request.signal },
  );
  const url = result.video?.url;
  if (!url) throw new ProviderError('Provider returned no video');

  const file = await fetch(url, { signal: request.signal });
  if (!file.ok)
    throw new ProviderError(
      `Video download failed: ${file.status}`,
      file.status,
    );
  return {
    data: Buffer.from(await file.arrayBuffer()),
    mimeType: 'video/mp4',
  };
}

async function falJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new ProviderError(
      `Provider returned ${response.status}: ${detail}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}
