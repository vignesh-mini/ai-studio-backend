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
import { pickAutoModel } from './auto-router.js';
import { type ChatTurn, streamChatCompletion } from './openai-compatible.js';

export interface ResolvedModel {
  model: CatalogueModel;
  apiKey: string;
}

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

    let modelId = requestedId;
    if (requestedId === AUTO_MODEL_ID) {
      const candidates = chatModels.filter(
        (m) => m.id !== AUTO_MODEL_ID && m.available,
      );
      modelId = pickAutoModel(prompt, candidates, plan) ?? '';
      if (!modelId) {
        throw new ServiceUnavailableException(
          'No AI provider is configured. Add an API key to the backend .env file.',
        );
      }
    }

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
    return { model, apiKey };
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
