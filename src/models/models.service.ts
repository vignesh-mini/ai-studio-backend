import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiModel, AiProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export const AUTO_MODEL_ID = 'auto';

export type CatalogueModel = AiModel & {
  provider: AiProvider;
  available: boolean;
};

@Injectable()
export class ModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  apiKeyFor(provider: AiProvider): string | undefined {
    return provider.apiKeyEnv
      ? this.config.get<string>(provider.apiKeyEnv) || undefined
      : undefined;
  }

  /**
   * Resolves `{ENV_NAME}` placeholders in a provider's base URL, e.g. the Cloudflare
   * account id. Returns undefined if any referenced variable is missing.
   */
  baseUrlFor(provider: AiProvider): string | undefined {
    let missing = false;
    const url = provider.baseUrl.replace(
      /\{([A-Z0-9_]+)\}/g,
      (_, name: string) => {
        const value = this.config.get<string>(name);
        if (!value) missing = true;
        return value ?? '';
      },
    );
    return missing ? undefined : url;
  }

  /** Every enabled model with an `available` flag computed from provider config. */
  async catalogue(): Promise<CatalogueModel[]> {
    const models = await this.prisma.aiModel.findMany({
      where: { enabled: true },
      include: { provider: true },
      orderBy: [{ task: 'asc' }, { sortOrder: 'asc' }],
    });

    const withFlags = models.map((model) => ({
      ...model,
      available: model.provider.enabled && this.isConfigured(model),
    }));
    const anyChat = withFlags.some(
      (m) => m.task === 'chat' && m.id !== AUTO_MODEL_ID && m.available,
    );
    return withFlags.map((m) =>
      m.id === AUTO_MODEL_ID ? { ...m, available: anyChat } : m,
    );
  }

  /** The public shape the app's model pickers use. */
  async list() {
    return (await this.catalogue()).map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider.name,
      task: m.task,
      description: m.description,
      tier: m.tier,
      capabilities: m.capabilities,
      available: m.available,
    }));
  }

  private isConfigured(model: AiModel & { provider: AiProvider }) {
    // The audio adapter arrives in Phase 6; until then the app serves voice from its
    // mock layer, so those catalogue entries stay selectable.
    if (model.task === 'audio') return true;
    if (model.id === AUTO_MODEL_ID) return true;
    return (
      !!this.apiKeyFor(model.provider) && !!this.baseUrlFor(model.provider)
    );
  }
}
