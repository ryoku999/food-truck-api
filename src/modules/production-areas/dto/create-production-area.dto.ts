import { ProductionAreaCode } from '@/generated/prisma/enums';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateProductionAreaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name!: string;

  @IsEnum(ProductionAreaCode)
  code!: ProductionAreaCode;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
