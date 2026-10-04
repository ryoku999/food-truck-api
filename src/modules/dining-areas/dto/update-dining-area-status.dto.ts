import { IsBoolean } from 'class-validator';

export class UpdateDiningAreaStatusDto {
  @IsBoolean()
  active!: boolean;
}
