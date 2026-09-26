import { FileType } from '@/generated/prisma/enums';
import { IsEnum } from 'class-validator';

export class UploadImageDto {
  @IsEnum(FileType)
  type!: FileType;
}
