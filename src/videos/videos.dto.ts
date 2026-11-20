import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GenerateVideoDto {
  @IsString()
  @MaxLength(64)
  model: string;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  prompt: string;

  @IsIn(['text-to-video', 'image-to-video'])
  mode: 'text-to-video' | 'image-to-video';

  @IsIn([4, 6, 8])
  durationSec: 4 | 6 | 8;

  @IsIn(['16:9', '9:16', '1:1'])
  aspectRatio: '16:9' | '9:16' | '1:1';

  /** Library image used as the first frame (image-to-video only). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceAssetId?: string;
}
