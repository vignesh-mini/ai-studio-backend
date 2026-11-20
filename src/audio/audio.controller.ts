import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { type AuthUser, CurrentUser, Public } from '../auth/decorators.js';
import { AudioService } from './audio.service.js';

export class SpeechDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  text: string;
}

@Controller('audio')
export class AudioController {
  constructor(private readonly audio: AudioService) {}

  /** Multipart upload with the recording in the `audio` field. */
  @Post('transcribe')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  // Whisper accepts up to 25 MB, several minutes of compressed speech.
  @UseInterceptors(
    FileInterceptor('audio', { limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  transcribe(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.audio.transcribe(user, file);
  }

  @Post('speech')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  speech(@Body() dto: SpeechDto) {
    return this.audio.speak(dto.text);
  }

  /** Public so the app's media player can stream it; the random id is the capability. */
  @Public()
  @SkipThrottle()
  @Get('speech/:id')
  play(@Param('id') id: string, @Res() res: Response) {
    const clip = this.audio.clip(id);
    res.set({ 'Content-Type': clip.mimeType, 'Cache-Control': 'private' });
    res.send(clip.data);
  }
}
