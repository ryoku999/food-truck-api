import { TableStatus } from '@/generated/prisma/enums';
import { IsEnum } from 'class-validator';

export class UpdateTableStatusDto {
  @IsEnum(TableStatus)
  status!: TableStatus;
}
