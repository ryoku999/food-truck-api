import { IsUUID } from 'class-validator';

export class ProductIdParamDto {
  @IsUUID()
  id!: string;
}

export class ProductImageParamDto extends ProductIdParamDto {
  @IsUUID()
  fileId!: string;
}

export class ProductModifierGroupParamDto extends ProductIdParamDto {
  @IsUUID()
  groupId!: string;
}

export class ProductVariantIdParamDto {
  @IsUUID()
  id!: string;
}

export class ComboGroupIdParamDto {
  @IsUUID()
  id!: string;
}

export class ComboGroupItemIdParamDto {
  @IsUUID()
  id!: string;
}
