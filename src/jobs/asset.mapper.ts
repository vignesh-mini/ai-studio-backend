import type { GeneratedAsset, GenerationJob } from '@prisma/client';

/** The asset shape the app expects. `url` is relative to the API base URL. */
export const toAssetDto = (asset: GeneratedAsset) => ({
  id: asset.id,
  type: asset.type,
  url: `/media/${asset.storageKey}`,
  prompt: asset.prompt,
  modelId: asset.modelId,
  aspectRatio: asset.aspectRatio,
  durationSec: asset.durationSec ?? undefined,
  createdAt: asset.createdAt.toISOString(),
});

export const toJobDto = (
  job: GenerationJob & { assets: GeneratedAsset[] },
) => ({
  jobId: job.id,
  type: job.type,
  status: job.status,
  progress: job.progress,
  assets: job.status === 'completed' ? job.assets.map(toAssetDto) : undefined,
  error: job.error ?? undefined,
});
