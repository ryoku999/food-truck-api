import { DatabaseService } from '@/database/database.service';
import { FileType } from '@/generated/prisma/enums';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import { randomUUID } from 'node:crypto';
import { FileIdParamDto } from './dto/file-id-param.dto';
import { UploadImageDto } from './dto/upload-image.dto';
import {
  DeleteFileResponse,
  FileResponse,
  FileUrlResponse,
} from './interfaces/file.interface';

const FILE_SELECT = {
  id: true,
  type: true,
  originalName: true,
  mimeType: true,
  size: true,
  createdAt: true,
} as const;

type SupportedImage = {
  extension: 'jpg' | 'png' | 'webp';
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
};

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);
  private readonly minio: MinioClient;
  private readonly businessBucket: string;
  private readonly productsBucket: string;
  private readonly urlExpirySeconds: number;
  private readonly maxImageSize: number;

  constructor(
    private readonly db: DatabaseService,
    configService: ConfigService,
  ) {
    this.minio = new MinioClient({
      endPoint: configService.getOrThrow<string>('MINIO_ENDPOINT'),
      port: configService.getOrThrow<number>('MINIO_PORT'),
      useSSL: configService.getOrThrow<boolean>('MINIO_USE_SSL'),
      accessKey: configService.getOrThrow<string>('MINIO_ROOT_USER'),
      secretKey: configService.getOrThrow<string>('MINIO_ROOT_PASSWORD'),
    });
    this.businessBucket = configService.getOrThrow<string>(
      'MINIO_BUSINESS_BUCKET',
    );
    this.productsBucket = configService.getOrThrow<string>(
      'MINIO_PRODUCTS_BUCKET',
    );
    this.urlExpirySeconds = configService.getOrThrow<number>(
      'MINIO_PRESIGNED_URL_EXPIRY_SECONDS',
    );
    this.maxImageSize = configService.getOrThrow<number>(
      'MINIO_MAX_IMAGE_SIZE',
    );
  }

  async onModuleInit(): Promise<void> {
    for (const bucket of [this.businessBucket, this.productsBucket]) {
      if (!(await this.minio.bucketExists(bucket))) {
        throw new Error(`El bucket de MinIO '${bucket}' no existe`);
      }
    }

    this.logger.log('Conexion con MinIO y buckets verificados');
  }

  async uploadImage(
    dto: UploadImageDto,
    file: Express.Multer.File | undefined,
  ): Promise<FileResponse> {
    if (!file) {
      throw new BadRequestException('La imagen es obligatoria');
    }
    if (file.size > this.maxImageSize) {
      throw new BadRequestException(
        `La imagen supera el limite de ${this.maxImageSize} bytes`,
      );
    }

    const detected = this.detectImage(file.buffer);
    if (!detected) {
      throw new BadRequestException(
        'Solo se permiten imagenes JPEG, PNG o WebP',
      );
    }

    const bucket = this.bucketFor(dto.type);
    const now = new Date();
    const objectKey = [
      dto.type.toLowerCase(),
      now.getUTCFullYear().toString(),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${randomUUID()}.${detected.extension}`,
    ].join('/');

    await this.minio.putObject(bucket, objectKey, file.buffer, file.size, {
      'Content-Type': detected.mimeType,
    });

    try {
      return await this.db.file.create({
        data: {
          type: dto.type,
          originalName: file.originalname,
          objectKey,
          bucket,
          mimeType: detected.mimeType,
          size: file.size,
        },
        select: FILE_SELECT,
      });
    } catch (error: unknown) {
      await this.minio.removeObject(bucket, objectKey).catch(() => undefined);
      throw error;
    }
  }

  async findOne(params: FileIdParamDto): Promise<FileResponse> {
    const file = await this.db.file.findUnique({
      where: { id: params.id },
      select: FILE_SELECT,
    });
    if (!file) {
      throw new NotFoundException('Archivo no encontrado');
    }
    return file;
  }

  async getUrl(params: FileIdParamDto): Promise<FileUrlResponse> {
    const file = await this.getStoredFile(params.id);
    return {
      url: await this.minio.presignedGetObject(
        file.bucket,
        file.objectKey,
        this.urlExpirySeconds,
      ),
      expiresInSeconds: this.urlExpirySeconds,
    };
  }

  async remove(params: FileIdParamDto): Promise<DeleteFileResponse> {
    const file = await this.db.file.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        bucket: true,
        objectKey: true,
        businessLogo: { select: { id: true } },
        productImages: { select: { id: true }, take: 1 },
        categoryImages: { select: { id: true }, take: 1 },
      },
    });
    if (!file) {
      throw new NotFoundException('Archivo no encontrado');
    }
    if (
      file.businessLogo ||
      file.productImages.length > 0 ||
      file.categoryImages.length > 0
    ) {
      throw new ConflictException(
        'El archivo esta asociado a un recurso y no puede eliminarse',
      );
    }

    await this.minio.removeObject(file.bucket, file.objectKey);
    await this.db.file.delete({ where: { id: file.id } });
    return { message: 'Archivo eliminado correctamente' };
  }

  async assertFileType(fileId: string, expectedType: FileType): Promise<void> {
    const file = await this.db.file.findUnique({
      where: { id: fileId },
      select: { type: true },
    });
    if (!file) {
      throw new NotFoundException('Archivo no encontrado');
    }
    if (file.type !== expectedType) {
      throw new BadRequestException(
        `El archivo debe ser de tipo ${expectedType}`,
      );
    }
  }

  async createPresignedUrl(fileId: string): Promise<string> {
    const file = await this.getStoredFile(fileId);
    return this.minio.presignedGetObject(
      file.bucket,
      file.objectKey,
      this.urlExpirySeconds,
    );
  }

  private async getStoredFile(fileId: string) {
    const file = await this.db.file.findUnique({
      where: { id: fileId },
      select: { bucket: true, objectKey: true },
    });
    if (!file) {
      throw new NotFoundException('Archivo no encontrado');
    }
    return file;
  }

  private bucketFor(type: FileType): string {
    return type === FileType.LOGO || type === FileType.OTHER
      ? this.businessBucket
      : this.productsBucket;
  }

  private detectImage(buffer: Buffer): SupportedImage | null {
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return { extension: 'jpg', mimeType: 'image/jpeg' };
    }
    if (
      buffer.length >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return { extension: 'png', mimeType: 'image/png' };
    }
    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return { extension: 'webp', mimeType: 'image/webp' };
    }
    return null;
  }
}
