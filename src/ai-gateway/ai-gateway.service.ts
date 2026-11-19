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
import { rankAutoModels } from './auto-router.js';
import {
  type ChatTurn,
  ProviderError,
  streamChatCompletion,
} from './openai-compatible.js';

export interface ResolvedModel {
  model: CatalogueModel;
  apiKey: string;
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
  ): Promise<ResolvedModel> {
    const chatModels = (await this.models.catalogue()).filter(
      (m) => m.task === 'chat',
    );

    if (requestedId === AUTO_MODEL_ID) {
      const candidates = chatModels.filter(
        (m) => m.id !== AUTO_MODEL_ID && m.available,
      );
      const [first, ...rest] = rankAutoModels(prompt, candidates, plan).map(
        (id) => this.toResolved(candidates.find((m) => m.id === id)!),
      );
      if (!first) {
        throw new ServiceUnavailableException(
          'No AI provider is configured. Add an API key to the backend .env file.',
        );
      }
      return { ...first, fallbacks: rest };
    }

    const modelId = requestedId;
    const model = chatModels.find((m) => m.id === modelId);
    if (!model || model.id === AUTO_MODEL_ID)
      throw new NotFoundException(`Unknown model "${modelId}"`);
    if (model.tier === 'premium' && plan === 'free') {
      throw new ForbiddenException(
        `${model.name} is available on the Premium plan`,
      );
    }
    const apiKey = this.models.apiKeyFor(model.provider);
    if (!model.available || !apiKey) {
      throw new ServiceUnavailableException(
        `${model.name} is not available right now`,
      );
    }
    return { model, apiKey, fallbacks: [] };
  }

  private toResolved(model: CatalogueModel): ResolvedModel {
    return {
      model,
      apiKey: this.models.apiKeyFor(model.provider)!,
      fallbacks: [],
    };
  }

  streamChat(
    { model, apiKey }: ResolvedModel,
    messages: ChatTurn[],
    signal: AbortSignal,
  ) {
    return streamChatCompletion({
      baseUrl: model.provider.baseUrl,
      apiKey,
      model: model.providerModel,
      messages,
      signal,
      headers: PROVIDER_HEADERS[model.providerId],
    });
  }
}
