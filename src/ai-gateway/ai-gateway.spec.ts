import { isRetryableProviderError } from './ai-gateway.service.js';
import { detectIntent, pickAutoModel, rankAutoModels } from './auto-router.js';
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
