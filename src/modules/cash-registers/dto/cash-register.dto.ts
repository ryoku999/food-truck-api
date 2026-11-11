import { CashMovementType } from '@/generated/prisma/enums';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCashRegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(trim)
  name!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCashRegisterDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CashRegisterQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  search?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  active?: boolean;
}

export class CashRegisterIdParamDto {
  @IsUUID()
  id!: string;
}

export class OpenCashSessionDto {
  @IsUUID()
  cashRegisterId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingAmount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  notes?: string;
}

export class CurrentCashSessionQueryDto {
  @IsUUID()
  cashRegisterId!: string;
}

export class CashSessionIdParamDto {
  @IsUUID()
  id!: string;
}

export class CreateCashMovementDto {
  @IsIn([
    CashMovementType.INCOME,
    CashMovementType.EXPENSE,
    CashMovementType.WITHDRAWAL,
    CashMovementType.ADJUSTMENT,
  ])
  type!:
    | typeof CashMovementType.INCOME
    | typeof CashMovementType.EXPENSE
    | typeof CashMovementType.WITHDRAWAL
    | typeof CashMovementType.ADJUSTMENT;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @ValidateIf(
    (dto: CreateCashMovementDto) =>
      dto.type === CashMovementType.INCOME ||
      dto.type === CashMovementType.EXPENSE ||
      dto.type === CashMovementType.WITHDRAWAL,
  )
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Transform(trim)
  description!: string;
}

export class CloseCashSessionDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  actualAmount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  notes?: string;
}
