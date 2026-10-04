import { IsUUID } from 'class-validator';

export class ModifierGroupIdParamDto {
  @IsUUID()
  id!: string;
}
