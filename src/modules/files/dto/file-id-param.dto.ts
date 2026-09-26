import { IsUUID } from 'class-validator';

export class FileIdParamDto {
  @IsUUID()
  id!: string;
}
