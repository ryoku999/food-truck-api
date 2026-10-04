import { IsBoolean } from 'class-validator';

export class UpdateModifierGroupStatusDto {
  @IsBoolean()
  active!: boolean;
}
