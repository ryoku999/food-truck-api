import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AttachCategoryImageDto } from './dto/attach-category-image.dto';
import { CategoryIdParamDto } from './dto/category-id-param.dto';
import { CategoryImageParamDto } from './dto/category-image-param.dto';
import { CategoryQueryDto } from './dto/category-query.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryImageDto } from './dto/update-category-image.dto';
import { UpdateCategoryStatusDto } from './dto/update-category-status.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoriesService } from './categories.service';
import { CategoryResponse } from './interfaces/category.interface';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  create(@Body() dto: CreateCategoryDto): Promise<CategoryResponse> {
    return this.categoriesService.create(dto);
  }

  @Get()
  @Auth()
  findAll(@Query() query: CategoryQueryDto): Promise<CategoryResponse[]> {
    return this.categoriesService.findAll(query);
  }

  @Get(':id')
  @Auth()
  findOne(@Param() params: CategoryIdParamDto): Promise<CategoryResponse> {
    return this.categoriesService.findOne(params);
  }

  @Patch(':id')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param() params: CategoryIdParamDto,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponse> {
    return this.categoriesService.update(params, dto);
  }

  @Patch(':id/status')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  updateStatus(
    @Param() params: CategoryIdParamDto,
    @Body() dto: UpdateCategoryStatusDto,
  ): Promise<CategoryResponse> {
    return this.categoriesService.updateStatus(params, dto);
  }

  @Post(':id/images')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  attachImage(
    @Param() params: CategoryIdParamDto,
    @Body() dto: AttachCategoryImageDto,
  ): Promise<CategoryResponse> {
    return this.categoriesService.attachImage(params, dto);
  }

  @Patch(':id/images/:fileId')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  updateImage(
    @Param() params: CategoryImageParamDto,
    @Body() dto: UpdateCategoryImageDto,
  ): Promise<CategoryResponse> {
    return this.categoriesService.updateImage(params, dto);
  }

  @Delete(':id/images/:fileId')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  removeImage(
    @Param() params: CategoryImageParamDto,
  ): Promise<CategoryResponse> {
    return this.categoriesService.removeImage(params);
  }
}
