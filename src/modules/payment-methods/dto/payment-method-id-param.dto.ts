import { IsUUID } from 'class-validator';

export class PaymentMethodIdParamDto {
  @IsUUID()
  id!: string;
}
