import {
  AiGatewayService,
  isRetryableProviderError,
} from './ai-gateway.service.js';
import { detectIntent, pickAutoModel, rankAutoModels } from './auto-router.js';
import { falVideoInput } from './fal-video.js';
import { ProviderError, SseDeltaParser } from './openai-compatible.js';

describe('SseDeltaParser', () => {
  const frame = (content: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;

  it('reassembles deltas split across network chunks', () => {
    const parser = new SseDeltaParser();
    const stream =
      frame('Hel') + ': keep-alive\n' + frame('lo') + 'data: [DONE]\n';
    const out = [
      stream.slice(0, 20),
      stream.slice(20, 55),
      stream.slice(55),
    ].flatMap((c) => parser.push(c));
    expect(out.join('')).toBe('Hello');
    expect(parser.done).toBe(true);
  });

  it('surfaces provider errors sent inside the stream', () => {
    const parser = new SseDeltaParser();
    expect(() => parser.push('data: {"error":{"message":"quota"}}\n')).toThrow(
      ProviderError,
    );
  });
});

describe('auto router', () => {
  const models = [
    { id: 'gemini-flash', tier: 'free' as const },
    { id: 'groq-qwen3-32b', tier: 'free' as const },
    { id: 'gemini-pro', tier: 'premium' as const },
  ];

  it('detects intent', () => {
    expect(detectIntent('Fix this TypeScript bug')).toBe('coding');
    expect(detectIntent('Explain step by step why the sky is blue')).toBe(
      'reasoning',
    );
    expect(detectIntent('Plan a weekend in Goa')).toBe('general');
  });

  it('routes coding prompts to a coding model', () => {
    expect(pickAutoModel('write a python function', models, 'free')).toBe(
      'groq-qwen3-32b',
    );
  });

  it('never routes free users to premium models', () => {
    expect(pickAutoModel('prove this theorem', models, 'free')).toBe(
      'gemini-flash',
    );
    expect(pickAutoModel('prove this theorem', models, 'premium')).toBe(
      'gemini-pro',
    );
  });

  it('never routes anyone to pay-per-use models', () => {
    const withPaid = [
      { id: 'claude-sonnet', tier: 'premium' as const, capabilities: ['paid'] },
      ...models,
    ];
    expect(
      rankAutoModels('prove this theorem', withPaid, 'premium'),
    ).not.toContain('claude-sonnet');
  });

  it('falls back to any configured model when preferred ones are missing', () => {
    expect(
      pickAutoModel('hello', [{ id: 'mistral-small', tier: 'free' }], 'free'),
    ).toBe('mistral-small');
    expect(pickAutoModel('hello', [], 'free')).toBeUndefined();
  });
});

describe('fallback chain', () => {
  const models = [
    { id: 'mistral-small', tier: 'free' as const },
    { id: 'gemini-flash', tier: 'free' as const },
    { id: 'groq-gpt-oss-120b', tier: 'free' as const },
    { id: 'gemini-pro', tier: 'premium' as const },
  ];

  it('ranks preferred models first, then every other allowed model', () => {
    expect(rankAutoModels('hello there', models, 'free')).toEqual([
      'gemini-flash',
      'groq-gpt-oss-120b',
      'mistral-small',
    ]);
  });

  it('retries on overload, rate limits and network errors, not on bad requests', () => {
    expect(isRetryableProviderError(new ProviderError('busy', 503))).toBe(true);
    expect(isRetryableProviderError(new ProviderError('quota', 429))).toBe(
      true,
    );
    expect(isRetryableProviderError(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryableProviderError(new ProviderError('bad', 400))).toBe(false);
    expect(isRetryableProviderError(new ProviderError('key', 401))).toBe(false);
  });
});

describe('streamChatGuarded', () => {
  const gateway = new AiGatewayService({} as never);
  const resolved = {} as never;

  const hangingStream = async function* (
    _r: unknown,
    _m: unknown,
    signal: AbortSignal,
  ): AsyncGenerator<string> {
    await new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(new Error('aborted'))),
    );
    yield '';
  };

  it('gives up on a provider that never starts answering', async () => {
    vi.spyOn(gateway, 'streamChat').mockImplementation(hangingStream as never);
    const run = async () => {
      for await (const _ of gateway.streamChatGuarded(
        resolved,
        [],
        new AbortController().signal,
        20,
      ));
    };
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBe(504);
    expect(isRetryableProviderError(error)).toBe(true);
  });

  it('does not time out once text is streaming', async () => {
    vi.spyOn(gateway, 'streamChat').mockImplementation(async function* () {
      yield 'Hel';
      await new Promise((r) => setTimeout(r, 40));
      yield 'lo';
    } as never);
    let text = '';
    for await (const delta of gateway.streamChatGuarded(
      resolved,
      [],
      new AbortController().signal,
      20,
    )) {
      text += delta;
    }
    expect(text).toBe('Hello');
  });
});

describe('falVideoInput', () => {
  const options = { prompt: 'waves', durationSec: 6, aspectRatio: '9:16' };

  it('maps Wan to 16 fps at its cheapest resolution', () => {
    const { endpoint, input } = falVideoInput(
      'fal-ai/wan/v2.2-a14b/text-to-video',
      options,
    );
    expect(endpoint).toBe('fal-ai/wan/v2.2-a14b/text-to-video');
    expect(input).toMatchObject({
      aspect_ratio: '9:16',
      frames_per_second: 16,
      num_frames: 97,
      resolution: '480p',
    });
  });

  it('switches to the image-to-video endpoint when a start frame is given', () => {
    const image = { ...options, imageUrl: 'data:image/png;base64,AAAA' };
    expect(
      falVideoInput('fal-ai/wan/v2.2-a14b/text-to-video', image).endpoint,
    ).toBe('fal-ai/wan/v2.2-a14b/image-to-video');
    const ltx = falVideoInput('fal-ai/ltx-video-13b-distilled', image);
    expect(ltx.endpoint).toBe('fal-ai/ltx-video-13b-distilled/image-to-video');
    expect(ltx.input).toMatchObject({
      image_url: image.imageUrl,
      frame_rate: 24,
      num_frames: 145,
    });
  });
});
