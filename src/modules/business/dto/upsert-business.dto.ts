import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class UpsertBusinessDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  tradeName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  documentNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  address?: string | null;

  @IsString()
  @Length(3, 3)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  currencyCode: string = 'PEN';
}
