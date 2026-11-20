import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service.js';
import { type AudioFile, speakableText } from '../ai-gateway/speech.js';
import { type AuthUser } from '../auth/decorators.js';
import { UsageService } from '../usage/usage.service.js';

const SPEECH_TTL_MS = 10 * 60_000;
const MAX_CACHED_CLIPS = 100;

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);
  /**
   * Spoken replies are played once, right away, so they are kept in memory for a few
   * minutes instead of filling object storage. The random id is the capability.
   */
  private readonly clips = new Map<string, AudioFile & { expires: number }>();

  constructor(
    private readonly gateway: AiGatewayService,
    private readonly usage: UsageService,
  ) {}

  async transcribe(user: AuthUser, file?: Express.Multer.File) {
    if (!file?.buffer.length) {
      throw new BadRequestException('No recording was received.');
    }
    await this.usage.assertVoiceQuota(user);
    const resolved = await this.gateway.resolveAudioModel('transcription');
    try {
      const text = await this.gateway.transcribe(resolved, {
        data: file.buffer,
        name: file.originalname || 'speech.m4a',
        mimeType: file.mimetype || 'audio/mp4',
      });
      await this.usage.record({
        userId: user.id,
        task: 'audio',
        modelId: resolved.model.id,
        providerId: resolved.model.providerId,
        inputTokens: 0,
        outputTokens: 0,
      });
      return { text };
    } catch (error) {
      this.logger.warn(`Transcription failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Could not transcribe the recording. Please try again.',
      );
    }
  }

  async speak(text: string) {
    const speakable = speakableText(text);
    if (!speakable) throw new BadRequestException('Nothing to read aloud.');
    const resolved = await this.gateway.resolveAudioModel('speech');
    let audio: AudioFile;
    try {
      audio = await this.gateway.synthesize(resolved, speakable);
    } catch (error) {
      this.logger.warn(`Speech synthesis failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Could not create the spoken reply. Please try again.',
      );
    }
    this.prune();
    const id = randomBytes(24).toString('hex');
    this.clips.set(id, { ...audio, expires: Date.now() + SPEECH_TTL_MS });
    return { audioUrl: `/audio/speech/${id}` };
  }

  clip(id: string) {
    const clip = this.clips.get(id);
    if (!clip || clip.expires < Date.now()) throw new NotFoundException();
    return clip;
  }

  private prune() {
    const now = Date.now();
    for (const [id, clip] of this.clips) {
      if (clip.expires < now) this.clips.delete(id);
    }
    // Map iteration is insertion order, so the oldest clips go first.
    for (const id of this.clips.keys()) {
      if (this.clips.size < MAX_CACHED_CLIPS) break;
      this.clips.delete(id);
    }
  }
}
