import { IsBoolean } from 'class-validator';

export class UpdateProductionAreaStatusDto {
  @IsBoolean()
  active!: boolean;
}
