import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import { type AuthUser, CurrentUser } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toUserDto } from './user.mapper.js';

@Controller('profile')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

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
    await this.prisma.user.delete({ where: { id: user.id } });
  }
}
