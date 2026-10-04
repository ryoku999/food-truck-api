import { IsUUID } from 'class-validator';

export class CategoryImageParamDto {
  @IsUUID()
  id!: string;

  @IsUUID()
  fileId!: string;
}
