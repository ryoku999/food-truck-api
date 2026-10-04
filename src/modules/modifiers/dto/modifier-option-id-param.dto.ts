import { IsUUID } from 'class-validator';

export class ModifierOptionIdParamDto {
  @IsUUID()
  id!: string;
}
