import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { type AuthUser, CurrentUser, Public } from '../auth/decorators.js';
import { toAssetDto } from '../jobs/asset.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

@Controller()
export class LibraryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get('library')
  async list(@CurrentUser() user: AuthUser) {
    const assets = await this.prisma.generatedAsset.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return assets.map(toAssetDto);
  }

  @Delete('library/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const asset = await this.prisma.generatedAsset.findUnique({
      where: { id },
    });
    if (!asset || asset.userId !== user.id) throw new NotFoundException();
    await this.prisma.generatedAsset.delete({ where: { id } });
    await this.storage.remove(asset.storageKey);
  }

  /**
   * Serves media files. Public because <Image> cannot send auth headers; the 192-bit
   * random key is the capability. Production moves this to R2 with signed URLs.
   */
  @Public()
  @SkipThrottle()
  @Get('media/:key')
  async media(@Param('key') key: string, @Res() res: Response) {
    const { data, mimeType } = await this.storage.get(key);
    res.set({
      'Content-Type': mimeType,
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    res.send(data);
  }
}
