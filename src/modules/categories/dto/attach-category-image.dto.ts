import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class AttachCategoryImageDto {
  @IsUUID()
  fileId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
