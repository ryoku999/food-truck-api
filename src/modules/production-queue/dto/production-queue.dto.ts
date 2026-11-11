import { OrderItemStatus } from '@/generated/prisma/enums';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class ProductionQueueQueryDto {
  @IsOptional()
  @IsEnum(OrderItemStatus)
  status?: OrderItemStatus;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  search?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}

export class UpdatePreparationStatusDto {
  @IsEnum(OrderItemStatus)
  status!: OrderItemStatus;

  @ValidateIf(
    (dto: UpdatePreparationStatusDto) =>
      dto.status === OrderItemStatus.CANCELLED,
  )
  @IsString()
  @MaxLength(500)
  cancellationReason?: string;
}

export class ProductionItemIdParamDto {
  @IsUUID()
  id!: string;
}
