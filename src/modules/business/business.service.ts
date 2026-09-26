import { DatabaseService } from '@/database/database.service';
import { FileType } from '@/generated/prisma/enums';
import { FilesService } from '@/modules/files/files.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { SetBusinessLogoDto } from './dto/set-business-logo.dto';
import { UpsertBusinessDto } from './dto/upsert-business.dto';
import { BusinessResponse } from './interfaces/business.interface';

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

const BUSINESS_INCLUDE = {
  logoFile: {
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      size: true,
    },
  },
} as const;

@Injectable()
export class BusinessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly filesService: FilesService,
  ) {}

  async findSettings(): Promise<BusinessResponse> {
    const business = await this.db.business.findUnique({
      where: { id: BUSINESS_ID },
      include: BUSINESS_INCLUDE,
    });
    if (!business) {
      throw new NotFoundException('La configuracion del negocio no existe');
    }
    return this.toResponse(business);
  }

  async upsert(dto: UpsertBusinessDto): Promise<BusinessResponse> {
    const business = await this.db.business.upsert({
      where: { id: BUSINESS_ID },
      create: { id: BUSINESS_ID, ...dto },
      update: dto,
      include: BUSINESS_INCLUDE,
    });
    return this.toResponse(business);
  }

  async setLogo(dto: SetBusinessLogoDto): Promise<BusinessResponse> {
    await this.filesService.assertFileType(dto.fileId, FileType.LOGO);

    const updated = await this.db.business.updateMany({
      where: { id: BUSINESS_ID },
      data: { logoFileId: dto.fileId },
    });
    if (updated.count !== 1) {
      throw new NotFoundException('La configuracion del negocio no existe');
    }
    return this.findSettings();
  }

  async removeLogo(): Promise<BusinessResponse> {
    const updated = await this.db.business.updateMany({
      where: { id: BUSINESS_ID },
      data: { logoFileId: null },
    });
    if (updated.count !== 1) {
      throw new NotFoundException('La configuracion del negocio no existe');
    }
    return this.findSettings();
  }

  private async toResponse(business: {
    id: string;
    name: string;
    tradeName: string | null;
    description: string | null;
    documentNumber: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    currencyCode: string;
    createdAt: Date;
    updatedAt: Date;
    logoFile: {
      id: string;
      originalName: string;
      mimeType: string | null;
      size: number | null;
    } | null;
  }): Promise<BusinessResponse> {
    return {
      id: business.id,
      name: business.name,
      tradeName: business.tradeName,
      description: business.description,
      documentNumber: business.documentNumber,
      phone: business.phone,
      email: business.email,
      address: business.address,
      currencyCode: business.currencyCode,
      logo: business.logoFile
        ? {
            ...business.logoFile,
            url: await this.filesService.createPresignedUrl(
              business.logoFile.id,
            ),
          }
        : null,
      createdAt: business.createdAt,
      updatedAt: business.updatedAt,
    };
  }
}
