import { IsUUID } from 'class-validator';

export class SetBusinessLogoDto {
  @IsUUID()
  fileId!: string;
}
