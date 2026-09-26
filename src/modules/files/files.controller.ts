import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FileIdParamDto } from './dto/file-id-param.dto';
import { UploadImageDto } from './dto/upload-image.dto';
import { FilesService } from './files.service';
import {
  DeleteFileResponse,
  FileResponse,
  FileUrlResponse,
} from './interfaces/file.interface';

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('images')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @Body() dto: UploadImageDto,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<FileResponse> {
    return this.filesService.uploadImage(dto, file);
  }

  @Get(':id')
  @Auth()
  findOne(@Param() params: FileIdParamDto): Promise<FileResponse> {
    return this.filesService.findOne(params);
  }

  @Get(':id/url')
  @Auth()
  getUrl(@Param() params: FileIdParamDto): Promise<FileUrlResponse> {
    return this.filesService.getUrl(params);
  }

  @Delete(':id')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  remove(@Param() params: FileIdParamDto): Promise<DeleteFileResponse> {
    return this.filesService.remove(params);
  }
}
