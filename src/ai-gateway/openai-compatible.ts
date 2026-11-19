export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Incremental parser for OpenAI-style streaming responses:
 *   data: {"choices":[{"delta":{"content":"Hel"}}]}
 *   data: [DONE]
 * Lines starting with ':' (keep-alive comments, e.g. from OpenRouter) are ignored.
 */
export class SseDeltaParser {
  private buffer = '';
  done = false;

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';

    const deltas: string[] = [];
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        this.done = true;
        break;
      }
      try {
        const json = JSON.parse(data);
        if (json.error)
          throw new ProviderError(json.error.message ?? 'Provider error');
        const content = json.choices?.[0]?.delta?.content;
        if (typeof content === 'string' && content) deltas.push(content);
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        // Partial or non-JSON frame: skip it.
      }
    }
    return deltas;
  }
}

export interface StreamRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatTurn[];
  signal: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Gemini, Groq, OpenRouter, Mistral and Cloudflare all expose an OpenAI-compatible
 * `/chat/completions` endpoint, so one adapter covers them; providers differ only in
 * base URL, key and model name, which come from the database.
 */
export async function* streamChatCompletion(
  request: StreamRequest,
): AsyncGenerator<string> {
  const response = await fetch(
    `${request.baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
        ...request.headers,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
      }),
      signal: request.signal,
    },
  );

  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new ProviderError(
      `Provider returned ${response.status}: ${detail}`,
      response.status,
    );
  }

  const parser = new SseDeltaParser();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  try {
    while (!parser.done) {
      const { value, done } = await reader.read();
      if (done) break;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}
