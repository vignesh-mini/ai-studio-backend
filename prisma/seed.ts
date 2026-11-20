// Seeds the provider and model catalogue. Safe to re-run: rows are upserted, so editing
// this file and running `yarn db:seed` updates names, provider models and descriptions.
// Runs with Node's built-in TypeScript support (type annotations only, no enums).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const providers = [
  { id: 'gateway', name: 'AI Gateway', baseUrl: '', apiKeyEnv: '' },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    // {CLOUDFLARE_ACCOUNT_ID} is filled in from .env at request time.
    baseUrl:
      'https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/run',
    apiKeyEnv: 'CLOUDFLARE_API_TOKEN',
  },
  {
    id: 'fal',
    name: 'fal.ai',
    baseUrl: 'https://fal.run',
    apiKeyEnv: 'FAL_KEY',
  },
  {
    id: 'replicate',
    name: 'Replicate',
    baseUrl: 'https://api.replicate.com/v1',
    apiKeyEnv: 'REPLICATE_API_TOKEN',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    baseUrl: 'https://router.huggingface.co',
    apiKeyEnv: 'HF_TOKEN',
  },
];

type Seed = {
  id: string;
  name: string;
  providerId: string;
  providerModel: string;
  task: 'chat' | 'image' | 'video' | 'audio';
  description: string;
  tier?: 'free' | 'premium';
  capabilities: string[];
  enabled?: boolean;
};

// `providerModel` values change as providers release new versions; check each console
// for current names and edit them here (or later in the admin panel).
const models: Seed[] = [
  {
    id: 'auto',
    name: 'Auto',
    providerId: 'gateway',
    providerModel: 'auto',
    task: 'chat',
    description: 'Routes each message to the best model for the task.',
    capabilities: ['routing'],
  },
  {
    id: 'gemini-flash',
    name: 'Gemini Flash',
    providerId: 'gemini',
    // gemini-2.5 is closed to new keys; 3.5 Flash is current and responsive.
    providerModel: 'gemini-3.5-flash',
    task: 'chat',
    description:
      'Default assistant. Great for general chat, images and documents.',
    capabilities: ['vision', 'long-context', 'documents'],
  },
  {
    id: 'groq-gpt-oss-120b',
    name: 'GPT-OSS 120B',
    providerId: 'groq',
    providerModel: 'openai/gpt-oss-120b',
    task: 'chat',
    description: 'Open-weight reasoning model on very fast inference hardware.',
    capabilities: ['fast', 'reasoning'],
  },
  {
    // Id kept stable for the router and saved chats; Groq retired qwen3-32b.
    id: 'groq-qwen3-32b',
    name: 'Qwen 3.8 27B',
    providerId: 'groq',
    providerModel: 'qwen/qwen3.8-27b',
    task: 'chat',
    description: 'Strong coding and multilingual model with fast responses.',
    capabilities: ['coding', 'fast'],
  },
  {
    id: 'openrouter-llama-free',
    name: 'Llama 3.3 70B (free)',
    providerId: 'openrouter',
    providerModel: 'meta-llama/llama-3.3-70b-instruct:free',
    task: 'chat',
    description: 'Free community model served through OpenRouter.',
    capabilities: ['reasoning'],
  },
  {
    id: 'mistral-small',
    name: 'Mistral Small',
    providerId: 'mistral',
    providerModel: 'mistral-small-latest',
    task: 'chat',
    description: 'Efficient model for coding and everyday questions.',
    capabilities: ['coding'],
    // Mistral's API needs a paid plan; enable once a key is added.
    enabled: false,
  },
  {
    id: 'gemini-pro',
    name: 'Gemini Pro',
    providerId: 'gemini',
    // Alias tracks the newest Pro; free Google keys have no Pro quota.
    providerModel: 'gemini-pro-latest',
    task: 'chat',
    description: 'Highest-quality reasoning for complex problems.',
    tier: 'premium',
    capabilities: ['reasoning', 'vision', 'long-context', 'documents'],
  },
  {
    id: 'flux-schnell',
    name: 'FLUX.1 schnell',
    providerId: 'cloudflare',
    providerModel: '@cf/black-forest-labs/flux-1-schnell',
    task: 'image',
    description: 'Fast, photorealistic text-to-image. Square images.',
    capabilities: [],
  },
  {
    id: 'lucid-origin',
    name: 'Lucid Origin',
    providerId: 'cloudflare',
    providerModel: '@cf/leonardo/lucid-origin',
    task: 'image',
    description: 'High-detail images in any aspect ratio.',
    tier: 'premium',
    capabilities: ['aspect-ratio'],
  },
  // Kept for history but hidden until adapters exist for these providers.
  {
    id: 'flux-dev',
    name: 'FLUX.1 dev',
    providerId: 'replicate',
    providerModel: 'black-forest-labs/flux-dev',
    task: 'image',
    description: 'Higher detail and prompt adherence.',
    tier: 'premium',
    capabilities: ['aspect-ratio'],
    enabled: false,
  },
  {
    id: 'sdxl',
    name: 'Stable Diffusion XL',
    providerId: 'huggingface',
    providerModel: 'stabilityai/stable-diffusion-xl-base-1.0',
    task: 'image',
    description: 'Versatile styles, image-to-image variations.',
    capabilities: ['aspect-ratio'],
    enabled: false,
  },
  {
    id: 'wan-2.2',
    name: 'Wan 2.2',
    providerId: 'fal',
    providerModel: 'fal-ai/wan/v2.2-a14b/text-to-video',
    task: 'video',
    description: 'Apache 2.0 open weights. Text-to-video and image-to-video.',
    capabilities: ['text-to-video', 'image-to-video'],
  },
  {
    id: 'ltx-video',
    name: 'LTX Video',
    providerId: 'replicate',
    providerModel: 'lightricks/ltx-video',
    task: 'video',
    description: 'Fast video generation with image-to-video support.',
    tier: 'premium',
    capabilities: ['text-to-video', 'image-to-video'],
  },
  {
    id: 'hunyuan-video',
    name: 'HunyuanVideo',
    providerId: 'fal',
    providerModel: 'fal-ai/hunyuan-video',
    task: 'video',
    description: 'High-quality cinematic text-to-video.',
    tier: 'premium',
    capabilities: ['text-to-video'],
  },
  {
    id: 'whisper-large-v3',
    name: 'Whisper large-v3',
    providerId: 'groq',
    providerModel: 'whisper-large-v3',
    task: 'audio',
    description: 'Speech-to-text transcription.',
    capabilities: ['transcription'],
  },
];

for (const provider of providers) {
  await prisma.aiProvider.upsert({
    where: { id: provider.id },
    create: provider,
    update: provider,
  });
}
for (const [index, model] of models.entries()) {
  const data = {
    ...model,
    tier: model.tier ?? 'free',
    enabled: model.enabled ?? true,
    sortOrder: index,
  };
  await prisma.aiModel.upsert({
    where: { id: model.id },
    create: data,
    update: data,
  });
}

console.log(
  `Seeded ${providers.length} providers and ${models.length} models.`,
);
await prisma.$disconnect();
