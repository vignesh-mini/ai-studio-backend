import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ChatMessageDto {
  @IsString()
  @MaxLength(64)
  id: string;

  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MinLength(1)
  @MaxLength(32_000)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  modelId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  attachments?: Array<{ name?: string; kind?: string }>;
}

export class SendMessageDto {
  /** Omitted for one-off requests (Compare, Voice) that should not be saved. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  /** Client-generated id of the reply, so app and server refer to the same message. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assistantMessageId?: string;

  @IsString()
  @MaxLength(64)
  modelId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  /** Full visible history. The server mirrors it, so edits and regenerations stay in sync. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];
}
