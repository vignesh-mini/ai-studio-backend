import {
  generateCloudflareImage,
  sniffImageType,
} from '../ai-gateway/cloudflare-images.js';
import { ProviderError } from '../ai-gateway/openai-compatible.js';
import { JobQueue } from '../jobs/job-queue.service.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]);
const request = {
  baseUrl: 'https://api.example/ai/run',
  apiKey: 'token',
  model: '@cf/black-forest-labs/flux-1-schnell',
  prompt: 'a dog',
  steps: 4,
};

describe('generateCloudflareImage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('decodes JSON base64 responses and detects the format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ result: { image: JPEG.toString('base64') } }),
        {
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const image = await generateCloudflareImage(request);
    expect(image.mimeType).toBe('image/jpeg');
    expect(image.data.equals(JPEG)).toBe(true);
    // Square-only models must not receive width/height (their schema rejects them).
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      prompt: 'a dog',
      steps: 4,
    });
  });

  it('accepts raw image responses and sends a size when given', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(PNG, { headers: { 'content-type': 'image/png' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const image = await generateCloudflareImage({
      ...request,
      width: 1344,
      height: 768,
    });
    expect(image.mimeType).toBe('image/png');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      width: 1344,
      height: 768,
    });
  });

  it('raises a ProviderError with the status on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('limit', { status: 429 })),
    );
    await expect(generateCloudflareImage(request)).rejects.toMatchObject({
      name: 'ProviderError',
      status: 429,
    } satisfies Partial<ProviderError>);
  });

  it('sniffs PNG and defaults to JPEG', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
  });
});

describe('JobQueue', () => {
  it('never runs more jobs at once than its concurrency', async () => {
    const queue = new JobQueue(2);
    let active = 0;
    let peak = 0;
    const done: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      done.push(
        new Promise<void>((resolve) =>
          queue.enqueue(`job${i}`, async () => {
            peak = Math.max(peak, ++active);
            await new Promise((r) => setTimeout(r, 10));
            active--;
            resolve();
          }),
        ),
      );
    }
    await Promise.all(done);
    await new Promise((r) => setTimeout(r, 0)); // let the last job's cleanup run
    expect(peak).toBe(2);
    expect(queue.size).toBe(0);
  });

  it('keeps running after a job throws', async () => {
    const queue = new JobQueue(1);
    queue.enqueue('bad', () => Promise.reject(new Error('boom')));
    await new Promise<void>((resolve) =>
      queue.enqueue('good', async () => resolve()),
    );
  });
});
