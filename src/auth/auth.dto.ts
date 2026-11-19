import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;
}

export class RegisterDto extends LoginDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(20)
  refreshToken: string;
}
