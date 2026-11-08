import { PrinterPurpose, PrintJobStatus } from '@/generated/prisma/enums';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class IdDto {
  @IsUUID() id!: string;
}
export class AgentUpdateDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class AgentCreateDto extends AgentUpdateDto {
  @IsString() @IsNotEmpty() @MaxLength(100) declare name: string;
}
export class PrinterUpdateDto extends AgentUpdateDto {
  @IsOptional() @IsEnum(PrinterPurpose) purpose?: PrinterPurpose;
  @IsOptional() @IsIn(['NETWORK_TCP', 'SYSTEM_PRINTER']) connectionType?:
    'NETWORK_TCP' | 'SYSTEM_PRINTER';
  @IsOptional() @IsString() @MaxLength(253) host?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsString() @MaxLength(200) systemName?: string;
  @IsOptional() @IsIn([58, 80]) paperWidth?: number;
  @IsOptional() @IsUUID() printerAgentId?: string;
  @IsOptional() @IsUUID() productionAreaId?: string;
}
export class PrinterCreateDto extends PrinterUpdateDto {}
export class PrinterQueryDto {
  @IsOptional() @IsEnum(PrinterPurpose) purpose?: PrinterPurpose;
  @IsOptional() @IsUUID() printerAgentId?: string;
}
export class JobQueryDto {
  @IsOptional() @IsEnum(PrintJobStatus) status?: PrintJobStatus;
  @IsOptional() @IsUUID() orderId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
}
export class TestPrinterDto {
  @IsOptional() @IsString() @MaxLength(300) message?: string;
}
export class PrintTicketDto {
  @IsOptional() @IsUUID() printerId?: string;
}
export class PrintResultDto {
  @IsInt() @Min(1) attempt!: number;
  @IsIn(['PRINTED', 'FAILED']) status!: 'PRINTED' | 'FAILED';
  @IsOptional() @IsString() @MaxLength(500) error?: string;
  @IsOptional() @IsBoolean() safeToRetry?: boolean;
}
