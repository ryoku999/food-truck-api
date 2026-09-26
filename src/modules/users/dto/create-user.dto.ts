import { UserRole, UserStatus } from '@/generated/prisma/enums';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-z0-9._-]+$/, {
    message:
      'username solo puede contener letras, numeros, punto, guion y guion bajo',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  username!: string;

  @IsString()
  @Matches(/^\d{8}$/, { message: 'dni debe contener exactamente 8 digitos' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  dni!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  lastName?: string;

  @IsEnum(UserRole)
  userRole!: UserRole;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
