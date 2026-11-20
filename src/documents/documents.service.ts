import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service.js';
import { type AuthUser, effectivePlan } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import {
  chunkDocument,
  extractDocumentText,
  parseAnalysis,
  selectRelevant,
  spread,
} from './document-text.js';

const ANALYZE_PROMPT =
  'You summarise documents. Reply with JSON only, no code fences: ' +
  '{"summary": "<3-5 sentence summary>", "keyPoints": ["<4-6 short key points>"]}. ' +
  'Use only the excerpts given; they are labelled with page numbers.';

const ASK_PROMPT =
  'Answer the question using only the document excerpts below, which are labelled ' +
  'with page numbers. Cite pages like (p. 3). If the excerpts do not contain the ' +
  'answer, say that the document does not cover it. Be concise.';

const fileKind = (file: Express.Multer.File): 'pdf' | 'text' | null => {
  const name = file.originalname.toLowerCase();
  if (file.mimetype === 'application/pdf' || name.endsWith('.pdf'))
    return 'pdf';
  if (file.mimetype.startsWith('text/') || /\.(txt|md|csv)$/.test(name))
    return 'text';
  return null;
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGatewayService,
    private readonly usage: UsageService,
  ) {}

  async upload(user: AuthUser, file?: Express.Multer.File) {
    if (!file?.buffer.length)
      throw new BadRequestException('No file was received.');
    const kind = fileKind(file);
    if (!kind) {
      throw new BadRequestException('Upload a PDF or a text file (.txt, .md).');
    }
    await this.usage.assertDocumentQuota(user);

    let extracted: Awaited<ReturnType<typeof extractDocumentText>>;
    try {
      extracted = await extractDocumentText(file.buffer, kind);
    } catch (error) {
      this.logger.warn(
        `Could not read ${file.originalname}: ${(error as Error).message}`,
      );
      throw new UnprocessableEntityException(
        'This file could not be read. It may be damaged or password-protected.',
      );
    }
    if (extracted.text.replace(/\s/g, '').length < 20) {
      throw new UnprocessableEntityException(
        'No text found. Scanned PDFs (photos of pages) are not supported yet.',
      );
    }

    const document = await this.prisma.document.create({
      data: {
        userId: user.id,
        name: file.originalname,
        mimeType: kind === 'pdf' ? 'application/pdf' : 'text/plain',
        size: file.size,
        pages: extracted.pages,
        text: extracted.text,
      },
    });
    return {
      fileId: document.id,
      name: document.name,
      mimeType: document.mimeType,
      size: document.size,
    };
  }

  async analyze(user: AuthUser, id: string) {
    const document = await this.find(user, id);
    let { summary, keyPoints } = document;
    if (!summary) {
      const reply = await this.complete(
        user,
        ANALYZE_PROMPT,
        spread(chunkDocument(document.text)),
      );
      ({ summary, keyPoints } = parseAnalysis(reply));
      await this.prisma.document.update({
        where: { id },
        data: { summary, keyPoints },
      });
    }
    return {
      fileId: document.id,
      fileName: document.name,
      pages: document.pages,
      summary,
      keyPoints,
    };
  }

  async ask(user: AuthUser, id: string, question: string) {
    const document = await this.find(user, id);
    await this.usage.assertChatQuota(user);
    const excerpts = selectRelevant(chunkDocument(document.text), question);
    const answer = await this.complete(
      user,
      ASK_PROMPT,
      `Excerpts from "${document.name}":\n\n${excerpts}\n\nQuestion: ${question}`,
    );
    return { answer: answer.trim() };
  }

  private async find(user: AuthUser, id: string) {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document || document.userId !== user.id) throw new NotFoundException();
    return document;
  }

  /** Auto-routed completion with the general intent, which favours long-context models. */
  private async complete(user: AuthUser, system: string, content: string) {
    const resolved = await this.gateway.resolveChatModel(
      'auto',
      effectivePlan(user),
      content,
      'general',
    );
    try {
      const reply = await this.gateway.completeText(
        resolved,
        [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
        90_000,
      );
      await this.usage.record({
        userId: user.id,
        task: 'chat',
        modelId: resolved.model.id,
        providerId: resolved.model.providerId,
        inputTokens: 0,
        outputTokens: 0,
      });
      return reply.replace(/<think>[\s\S]*?<\/think>/g, '');
    } catch (error) {
      this.logger.warn(`Document request failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'The AI providers are busy right now. Please try again in a moment.',
      );
    }
  }
}
