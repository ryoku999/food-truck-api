import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateModifierOptionStatusDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  available?: boolean;
}
