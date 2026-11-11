import { IsUUID } from 'class-validator';

export class ProductionAreaIdParamDto {
  @IsUUID()
  id!: string;
}
