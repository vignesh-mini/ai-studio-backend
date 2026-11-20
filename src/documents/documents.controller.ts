import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { type AuthUser, CurrentUser } from '../auth/decorators.js';
import { DocumentsService } from './documents.service.js';

export class AskDocumentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  question: string;
}

@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Multipart upload with the file in the `file` field; only its text is kept. */
  @Post('files/upload')
  @HttpCode(201)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.documents.upload(user, file);
  }

  @Post('documents/:id/analyze')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  analyze(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.analyze(user, id);
  }

  @Post('documents/:id/ask')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  ask(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AskDocumentDto,
  ) {
    return this.documents.ask(user, id, dto.question);
  }
}
