import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import { type AuthUser, CurrentUser } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { toUserDto } from './user.mapper.js';

@Controller('profile')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async profile(@CurrentUser() user: AuthUser) {
    const found = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!found) throw new NotFoundException();
    return toUserDto(found);
  }

  /** Privacy control: removes the account and, by cascade, all chats, tokens and usage. */
  @Delete('data')
  @HttpCode(204)
  async deleteData(@CurrentUser() user: AuthUser) {
    const assets = await this.prisma.generatedAsset.findMany({
      where: { userId: user.id },
      select: { storageKey: true },
    });
    await this.prisma.user.delete({ where: { id: user.id } });
    // Rows are gone via cascade; the media files must be removed explicitly.
    await Promise.all(assets.map((a) => this.storage.remove(a.storageKey)));
  }
}
