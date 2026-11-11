import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class ReportRangeDto {
  @IsISO8601({ strict: true })
  @Matches(/^20\d{2}-\d{2}-\d{2}$/)
  from!: string;

  @IsISO8601({ strict: true })
  @Matches(/^20\d{2}-\d{2}-\d{2}$/)
  to!: string;
}

export class SalesReportDto extends ReportRangeDto {
  @IsIn(['day', 'month'])
  groupBy: 'day' | 'month' = 'day';
}

export class ProductsReportDto extends ReportRangeDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class CashSessionsReportDto extends ReportRangeDto {
  @IsOptional()
  @IsUUID()
  cashRegisterId?: string;
}
