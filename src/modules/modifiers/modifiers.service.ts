import { DatabaseService } from '@/database/database.service';
import type { Prisma } from '@/generated/prisma/client';
import { ModifierSelectionType } from '@/generated/prisma/enums';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateModifierGroupDto } from './dto/create-modifier-group.dto';
import { CreateModifierOptionDto } from './dto/create-modifier-option.dto';
import { ModifierGroupIdParamDto } from './dto/modifier-group-id-param.dto';
import { ModifierGroupQueryDto } from './dto/modifier-group-query.dto';
import { ModifierOptionIdParamDto } from './dto/modifier-option-id-param.dto';
import { UpdateModifierGroupStatusDto } from './dto/update-modifier-group-status.dto';
import { UpdateModifierGroupDto } from './dto/update-modifier-group.dto';
import { UpdateModifierOptionStatusDto } from './dto/update-modifier-option-status.dto';
import { UpdateModifierOptionDto } from './dto/update-modifier-option.dto';
import {
  ModifierGroupResponse,
  ModifierOptionResponse,
} from './interfaces/modifier.interface';

const OPTION_SELECT = {
  id: true,
  modifierGroupId: true,
  name: true,
  priceDelta: true,
  active: true,
  available: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ModifierOptionSelect;

const GROUP_SELECT = {
  id: true,
  name: true,
  description: true,
  selectionType: true,
  minSelections: true,
  maxSelections: true,
  required: true,
  active: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  options: {
    select: OPTION_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  },
  _count: { select: { products: true } },
} satisfies Prisma.ModifierGroupSelect;

type ModifierGroupRecord = Prisma.ModifierGroupGetPayload<{
  select: typeof GROUP_SELECT;
}>;
type ModifierOptionRecord = Prisma.ModifierOptionGetPayload<{
  select: typeof OPTION_SELECT;
}>;

@Injectable()
export class ModifiersService {
  constructor(private readonly db: DatabaseService) {}

  async createGroup(
    dto: CreateModifierGroupDto,
  ): Promise<ModifierGroupResponse> {
    const rules = this.normalizeRules({
      selectionType: dto.selectionType ?? ModifierSelectionType.MULTIPLE,
      minSelections: dto.minSelections,
      maxSelections: dto.maxSelections,
      required: dto.required ?? false,
    });
    const group = await this.db.modifierGroup.create({
      data: { ...dto, ...rules },
      select: GROUP_SELECT,
    });
    return this.toGroupResponse(group);
  }

  async findAllGroups(
    query: ModifierGroupQueryDto,
  ): Promise<ModifierGroupResponse[]> {
    const groups = await this.db.modifierGroup.findMany({
      where: {
        active: query.active,
        selectionType: query.selectionType,
        ...(query.search
          ? { name: { contains: query.search, mode: 'insensitive' } }
          : {}),
      },
      select: GROUP_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return groups.map((group) => this.toGroupResponse(group));
  }

  async findOneGroup(
    params: ModifierGroupIdParamDto,
  ): Promise<ModifierGroupResponse> {
    return this.toGroupResponse(await this.getGroup(params.id));
  }

  async updateGroup(
    params: ModifierGroupIdParamDto,
    dto: UpdateModifierGroupDto,
  ): Promise<ModifierGroupResponse> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
    const current = await this.db.modifierGroup.findUnique({
      where: { id: params.id },
      select: {
        selectionType: true,
        minSelections: true,
        maxSelections: true,
        required: true,
      },
    });
    if (!current) {
      throw new NotFoundException('Grupo de modificadores no encontrado');
    }

    const selectionType = dto.selectionType ?? current.selectionType;
    const rules = this.normalizeRules({
      selectionType,
      minSelections: dto.minSelections ?? current.minSelections,
      maxSelections:
        dto.maxSelections !== undefined
          ? dto.maxSelections
          : dto.selectionType === ModifierSelectionType.SINGLE
            ? 1
            : current.maxSelections,
      required: dto.required ?? current.required,
    });
    await this.db.modifierGroup.update({
      where: { id: params.id },
      data: { ...dto, ...rules },
    });
    return this.findOneGroup(params);
  }

  async updateGroupStatus(
    params: ModifierGroupIdParamDto,
    dto: UpdateModifierGroupStatusDto,
  ): Promise<ModifierGroupResponse> {
    const updated = await this.db.modifierGroup.updateMany({
      where: { id: params.id },
      data: { active: dto.active },
    });
    if (updated.count !== 1) {
      throw new NotFoundException('Grupo de modificadores no encontrado');
    }
    return this.findOneGroup(params);
  }

  async createOption(
    params: ModifierGroupIdParamDto,
    dto: CreateModifierOptionDto,
  ): Promise<ModifierOptionResponse> {
    await this.ensureGroupExists(params.id);
    try {
      const option = await this.db.modifierOption.create({
        data: { modifierGroupId: params.id, ...dto },
        select: OPTION_SELECT,
      });
      return this.toOptionResponse(option);
    } catch (error: unknown) {
      this.rethrowOptionConflict(error);
      throw error;
    }
  }

  async updateOption(
    params: ModifierOptionIdParamDto,
    dto: UpdateModifierOptionDto,
  ): Promise<ModifierOptionResponse> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
    try {
      const updated = await this.db.modifierOption.updateMany({
        where: { id: params.id },
        data: dto,
      });
      if (updated.count !== 1) {
        throw new NotFoundException('Opcion de modificador no encontrada');
      }
      return this.findOneOption(params.id);
    } catch (error: unknown) {
      this.rethrowOptionConflict(error);
      throw error;
    }
  }

  async updateOptionStatus(
    params: ModifierOptionIdParamDto,
    dto: UpdateModifierOptionStatusDto,
  ): Promise<ModifierOptionResponse> {
    if (dto.active === undefined && dto.available === undefined) {
      throw new BadRequestException(
        'Debe enviar active o available para actualizar',
      );
    }
    const data = {
      ...dto,
      ...(dto.active === false ? { available: false } : {}),
    };
    const updated = await this.db.modifierOption.updateMany({
      where: { id: params.id },
      data,
    });
    if (updated.count !== 1) {
      throw new NotFoundException('Opcion de modificador no encontrada');
    }
    return this.findOneOption(params.id);
  }

  private normalizeRules(input: {
    selectionType: ModifierSelectionType;
    minSelections?: number;
    maxSelections?: number | null;
    required: boolean;
  }) {
    if (
      input.selectionType === ModifierSelectionType.SINGLE &&
      input.maxSelections !== undefined &&
      input.maxSelections !== null &&
      input.maxSelections !== 1
    ) {
      throw new BadRequestException(
        'Un grupo de seleccion simple debe tener maxSelections igual a 1',
      );
    }
    const minSelections = input.minSelections ?? (input.required ? 1 : 0);
    const maxSelections =
      input.selectionType === ModifierSelectionType.SINGLE
        ? 1
        : (input.maxSelections ?? null);

    if (input.required && minSelections < 1) {
      throw new BadRequestException(
        'Un grupo requerido debe permitir al menos una seleccion',
      );
    }
    if (
      input.selectionType === ModifierSelectionType.SINGLE &&
      minSelections > 1
    ) {
      throw new BadRequestException(
        'Un grupo de seleccion simple no puede exigir mas de una opcion',
      );
    }
    if (maxSelections !== null && minSelections > maxSelections) {
      throw new BadRequestException(
        'minSelections no puede ser mayor que maxSelections',
      );
    }

    return {
      selectionType: input.selectionType,
      minSelections,
      maxSelections,
      required: input.required,
    };
  }

  private async getGroup(id: string): Promise<ModifierGroupRecord> {
    const group = await this.db.modifierGroup.findUnique({
      where: { id },
      select: GROUP_SELECT,
    });
    if (!group) {
      throw new NotFoundException('Grupo de modificadores no encontrado');
    }
    return group;
  }

  private async ensureGroupExists(id: string): Promise<void> {
    const group = await this.db.modifierGroup.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!group) {
      throw new NotFoundException('Grupo de modificadores no encontrado');
    }
  }

  private async findOneOption(id: string): Promise<ModifierOptionResponse> {
    const option = await this.db.modifierOption.findUnique({
      where: { id },
      select: OPTION_SELECT,
    });
    if (!option) {
      throw new NotFoundException('Opcion de modificador no encontrada');
    }
    return this.toOptionResponse(option);
  }

  private toGroupResponse(group: ModifierGroupRecord): ModifierGroupResponse {
    const { options, _count, ...data } = group;
    return {
      ...data,
      productCount: _count.products,
      options: options.map((option) => this.toOptionResponse(option)),
    };
  }

  private toOptionResponse(
    option: ModifierOptionRecord,
  ): ModifierOptionResponse {
    return { ...option, priceDelta: option.priceDelta.toString() };
  }

  private rethrowOptionConflict(error: unknown): void {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Ya existe una opcion con ese nombre dentro del grupo',
      );
    }
  }
}
