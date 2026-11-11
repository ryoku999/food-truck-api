import { IsUUID } from 'class-validator';

export class DiningAreaIdParamDto {
  @IsUUID()
  id!: string;
}
