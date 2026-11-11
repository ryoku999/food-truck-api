import { Transform, Type } from 'class-transformer';
import {
  IsNotEmpty,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  ValidateNested,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
  Max,
  Min,
} from 'class-validator';

class BillPartLineDto {
  @IsUUID()
  orderItemId!: string;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
}

export class CreateBillPartDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((line: BillPartLineDto) => line?.orderItemId)
  @ValidateNested({ each: true })
  @Type(() => BillPartLineDto)
  items!: BillPartLineDto[];
}

class DirectBillPartDto extends CreateBillPartDto {
  @IsString()
  @Matches(/^\d{1,8}\.\d{2}$/)
  expectedTotal!: string;
}

export class CreatePaymentDto {
  @IsUUID()
  paymentMethodId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999.99)
  amount!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999.99)
  receivedAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsUUID()
  cashSessionId!: string;

  @IsOptional()
  @IsUUID()
  billPartId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DirectBillPartDto)
  productSelection?: DirectBillPartDto;
}

export class CancelPaymentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class PaymentIdParamDto {
  @IsUUID()
  id!: string;
}

export class PaymentOrderIdParamDto {
  @IsUUID()
  id!: string;
}

export class BillPartIdParamDto extends PaymentOrderIdParamDto {
  @IsUUID()
  partId!: string;
}
