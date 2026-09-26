import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        limits: {
          fileSize: configService.getOrThrow<number>('MINIO_MAX_IMAGE_SIZE'),
          files: 1,
        },
      }),
    }),
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
