import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ComboSelectionDto {
  @IsUUID()
  comboGroupId!: string;

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  comboGroupItemIds!: string[];
}

export class AddOrderItemDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  productVariantId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  modifierOptionIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ComboSelectionDto)
  comboSelections?: ComboSelectionDto[];
}

export class UpdateDraftOrderItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class CancelOrderItemDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}
