import { ProviderError } from './openai-compatible.js';

export interface AudioFile {
  data: Buffer;
  name: string;
  mimeType: string;
}

/** OpenAI-compatible `/audio/transcriptions` (Groq Whisper). */
export async function transcribeAudio(request: {
  baseUrl: string;
  apiKey: string;
  model: string;
  file: AudioFile;
  signal?: AbortSignal;
}): Promise<string> {
  const form = new FormData();
  form.append('model', request.model);
  form.append(
    'file',
    new Blob([new Uint8Array(request.file.data)], {
      type: request.file.mimeType,
    }),
    request.file.name,
  );
  const response = await fetch(`${request.baseUrl}/audio/transcriptions`, {
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
  const json = (await response.json()) as { text?: string };
  return json.text?.trim() ?? '';
}

/**
 * Cloudflare Workers AI text-to-speech. Deepgram Aura answers with MP3 bytes; MeloTTS
 * answers with JSON holding base64 audio, so both are handled.
 */
export async function synthesizeSpeech(request: {
  baseUrl: string;
  apiKey: string;
  model: string;
  text: string;
  signal?: AbortSignal;
}): Promise<AudioFile> {
  const response = await fetch(`${request.baseUrl}/${request.model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${request.apiKey}`,
    },
    body: JSON.stringify({ text: request.text, prompt: request.text }),
    signal: request.signal,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new ProviderError(
      `Provider returned ${response.status}: ${detail}`,
      response.status,
    );
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.startsWith('audio/')) {
    return {
      data: Buffer.from(await response.arrayBuffer()),
      name: 'speech.mp3',
      mimeType: contentType.split(';')[0],
    };
  }
  const json = (await response.json()) as { result?: { audio?: string } };
  if (!json.result?.audio)
    throw new ProviderError('Provider returned no audio');
  return {
    data: Buffer.from(json.result.audio, 'base64'),
    name: 'speech.mp3',
    mimeType: 'audio/mpeg',
  };
}

/**
 * Turns a markdown reply into something pleasant to hear: code blocks, links and
 * formatting marks are dropped, and long replies are cut at a sentence boundary.
 */
export function speakableText(markdown: string, maxLength = 1500) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastStop = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
  );
  return lastStop > maxLength / 2 ? cut.slice(0, lastStop + 1) : cut;
}
