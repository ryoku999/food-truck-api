import { IsUUID } from 'class-validator';

export class OrderIdParamDto {
  @IsUUID()
  id!: string;
}

export class OrderItemParamDto extends OrderIdParamDto {
  @IsUUID()
  itemId!: string;
}
