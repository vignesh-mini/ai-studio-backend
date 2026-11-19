import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;

export class GenerateImageDto {
  @IsString()
  @MaxLength(64)
  model: string;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  prompt: string;

  @IsIn([1, 2, 4])
  count: 1 | 2 | 4;

  @IsIn(ASPECT_RATIOS)
  aspectRatio: (typeof ASPECT_RATIOS)[number];

  @IsIn(['standard', 'high'])
  quality: 'standard' | 'high';
}

export class EnhancePromptDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  prompt: string;
}
