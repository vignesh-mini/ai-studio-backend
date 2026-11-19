import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Plan } from '@prisma/client';
import {
  AUTO_MODEL_ID,
  type CatalogueModel,
  ModelsService,
} from '../models/models.service.js';
import { type Intent, rankAutoModels } from './auto-router.js';
import { generateCloudflareImage, IMAGE_SIZES } from './cloudflare-images.js';
import {
  type ChatTurn,
  ProviderError,
  streamChatCompletion,
} from './openai-compatible.js';

export interface ResolvedModel {
  model: CatalogueModel;
  apiKey: string;
  baseUrl: string;
  /** Auto only: models to try in order if this one is overloaded or down. */
  fallbacks: ResolvedModel[];
}

/** Rate limits, provider outages and network failures are worth trying elsewhere. */
export const isRetryableProviderError = (error: unknown) =>
  !(error instanceof ProviderError) ||
  error.status === undefined ||
  error.status === 408 ||
  error.status === 429 ||
  error.status >= 500;

// Optional attribution headers some providers ask for.
const PROVIDER_HEADERS: Record<string, Record<string, string>> = {
  openrouter: { 'X-Title': 'AI Studio' },
};

/**
 * The single entry point for model calls. Screens never pick a provider; they send a
 * model id and the gateway validates it, applies Auto routing and plan rules, and
 * dispatches to the right adapter.
 */
@Injectable()
export class AiGatewayService {
  constructor(private readonly models: ModelsService) {}

  async resolveChatModel(
    requestedId: string,
    plan: Plan,
    prompt: string,
    intent?: Intent,
  ): Promise<ResolvedModel> {
    const chatModels = (await this.models.catalogue()).filter(
      (m) => m.task === 'chat',
    );

    if (requestedId === AUTO_MODEL_ID) {
      const candidates = chatModels.filter(
        (m) => m.id !== AUTO_MODEL_ID && m.available,
      );
      const [first, ...rest] = rankAutoModels(
        prompt,
        candidates,
        plan,
        intent,
      ).map((id) => this.toResolved(candidates.find((m) => m.id === id)!));
      if (!first) {
        throw new ServiceUnavailableException(
          'No AI provider is configured. Add an API key to the backend .env file.',
        );
      }
      return { ...first, fallbacks: rest };
    }

    return this.resolveExplicit(chatModels, requestedId, plan);
  }

  async resolveImageModel(modelId: string, plan: Plan): Promise<ResolvedModel> {
    const imageModels = (await this.models.catalogue()).filter(
      (m) => m.task === 'image',
    );
    return this.resolveExplicit(imageModels, modelId, plan);
  }

  private resolveExplicit(
    models: CatalogueModel[],
    modelId: string,
    plan: Plan,
  ): ResolvedModel {
    const model = models.find((m) => m.id === modelId);
    if (!model || model.id === AUTO_MODEL_ID)
      throw new NotFoundException(`Unknown model "${modelId}"`);
    if (model.tier === 'premium' && plan === 'free') {
      throw new ForbiddenException(
        `${model.name} is available on the Premium plan`,
      );
    }
    if (!model.available) {
      throw new ServiceUnavailableException(
        `${model.name} is not available right now`,
      );
    }
    return this.toResolved(model);
  }

  private toResolved(model: CatalogueModel): ResolvedModel {
    return {
      model,
      apiKey: this.models.apiKeyFor(model.provider)!,
      baseUrl: this.models.baseUrlFor(model.provider)!,
      fallbacks: [],
    };
  }

  /** Non-streaming completion with the same fallback chain as Auto chat. */
  async completeText(resolved: ResolvedModel, messages: ChatTurn[]) {
    const attempts = [resolved, ...resolved.fallbacks];
    for (const [index, attempt] of attempts.entries()) {
      try {
        let text = '';
        for await (const delta of this.streamChatGuarded(
          attempt,
          messages,
          AbortSignal.timeout(25_000),
          12_000,
        )) {
          text += delta;
        }
        return text;
      } catch (error) {
        if (index === attempts.length - 1 || !isRetryableProviderError(error)) {
          throw error;
        }
      }
    }
    throw new ServiceUnavailableException();
  }

  /**
   * streamChat with a time-to-first-token limit. Overloaded providers sometimes hang
   * for a minute before failing; giving up early lets Auto fall back to the next
   * model while the user is still waiting. The limit stops once text starts arriving.
   */
  async *streamChatGuarded(
    resolved: ResolvedModel,
    messages: ChatTurn[],
    signal: AbortSignal,
    firstTokenMs: number,
  ): AsyncGenerator<string> {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal.reason);
    if (signal.aborted) forwardAbort();
    signal.addEventListener('abort', forwardAbort, { once: true });
    const timeout = new ProviderError(
      `No response within ${firstTokenMs / 1000}s`,
      504,
    );
    const timer = setTimeout(() => controller.abort(timeout), firstTokenMs);

    try {
      for await (const delta of this.streamChat(
        resolved,
        messages,
        controller.signal,
      )) {
        clearTimeout(timer);
        yield delta;
      }
    } catch (error) {
      // Surface the timeout itself (retryable) rather than the generic AbortError.
      if (controller.signal.reason === timeout && !signal.aborted)
        throw timeout;
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', forwardAbort);
    }
  }

  generateImage(
    { model, apiKey, baseUrl }: ResolvedModel,
    options: { prompt: string; steps: number; aspectRatio: string },
  ) {
    // Models without the capability (e.g. FLUX.1 schnell) only produce square images.
    const size = model.capabilities.includes('aspect-ratio')
      ? IMAGE_SIZES[options.aspectRatio]
      : undefined;
    return generateCloudflareImage({
      baseUrl,
      apiKey,
      model: model.providerModel,
      prompt: options.prompt,
      steps: options.steps,
      ...size,
      signal: AbortSignal.timeout(120_000),
    });
  }

  streamChat(
    { model, apiKey, baseUrl }: ResolvedModel,
    messages: ChatTurn[],
    signal: AbortSignal,
  ) {
    return streamChatCompletion({
      baseUrl,
      apiKey,
      model: model.providerModel,
      messages,
      signal,
      headers: PROVIDER_HEADERS[model.providerId],
    });
  }
}
