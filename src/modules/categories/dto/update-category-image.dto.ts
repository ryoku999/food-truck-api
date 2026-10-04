import { IsInt, Min } from 'class-validator';

export class UpdateCategoryImageDto {
  @IsInt()
  @Min(0)
  sortOrder!: number;
}
