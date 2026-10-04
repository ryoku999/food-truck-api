import { IsUUID } from 'class-validator';

export class TableIdParamDto {
  @IsUUID()
  id!: string;
}
