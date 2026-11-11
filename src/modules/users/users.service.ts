import { DatabaseService } from '@/database/database.service';
import type { Prisma } from '@/generated/prisma/client';
import { UserRole, UserStatus } from '@/generated/prisma/enums';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AdminChangePasswordDto } from './dto/admin-change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserIdParamDto } from './dto/user-id-param.dto';
import { UserListQueryDto } from './dto/user-list-query.dto';
import {
  MessageResponse,
  PaginatedUsersResponse,
  UserResponse,
} from './interfaces/user.interface';

const USER_SELECT = {
  id: true,
  username: true,
  dni: true,
  firstName: true,
  lastName: true,
  userRole: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async create(dto: CreateUserDto, actorId: string): Promise<UserResponse> {
    await this.ensureUniqueIdentity(dto.username, dto.dni);
    const password = await bcrypt.hash(dto.password, 12);

    try {
      return await this.db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            username: dto.username,
            dni: dto.dni,
            password,
            firstName: dto.firstName,
            lastName: dto.lastName,
            userRole: dto.userRole,
            status: dto.status,
          },
          select: USER_SELECT,
        });
        await tx.auditLog.create({
          data: {
            action: 'CREATE',
            entity: 'User',
            entityId: user.id,
            userId: actorId,
            newData: {
              username: user.username,
              userRole: user.userRole,
              status: user.status,
            },
          },
        });
        return user;
      });
    } catch (error: unknown) {
      this.rethrowUniqueConstraint(error);
      throw error;
    }
  }

  async findAll(query: UserListQueryDto): Promise<PaginatedUsersResponse> {
    const where: Prisma.UserWhereInput = {
      userRole: query.userRole,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { username: { contains: query.search, mode: 'insensitive' } },
              { dni: { contains: query.search } },
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.pageSize;

    const [items, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip,
        take: query.pageSize,
      }),
      this.db.user.count({ where }),
    ]);

    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        pageCount: Math.ceil(total / query.pageSize),
      },
    };
  }

  async findOne(params: UserIdParamDto): Promise<UserResponse> {
    const user = await this.db.user.findUnique({
      where: { id: params.id },
      select: USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return user;
  }

  async update(
    params: UserIdParamDto,
    dto: UpdateUserDto,
    actorId: string,
  ): Promise<UserResponse> {
    if (dto.username || dto.dni) {
      await this.ensureUniqueIdentity(dto.username, dto.dni, params.id);
    }

    try {
      return await this.db.$transaction(
        async (transaction) => {
          const current = await transaction.user.findUnique({
            where: { id: params.id },
            select: { id: true, userRole: true, status: true },
          });

          if (!current) {
            throw new NotFoundException('Usuario no encontrado');
          }

          if (dto.userRole && dto.userRole !== UserRole.ADMIN) {
            await this.ensureAdminRemains(transaction, current);
          }

          const user = await transaction.user.update({
            where: { id: params.id },
            data: dto,
            select: USER_SELECT,
          });
          await transaction.auditLog.create({
            data: {
              action: 'UPDATE',
              entity: 'User',
              entityId: user.id,
              userId: actorId,
              newData: {
                username: user.username,
                userRole: user.userRole,
                status: user.status,
              },
            },
          });
          return user;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: unknown) {
      this.rethrowUniqueConstraint(error);
      throw error;
    }
  }

  async updateStatus(
    params: UserIdParamDto,
    dto: UpdateUserStatusDto,
    actorId: string,
  ): Promise<UserResponse> {
    return this.db.$transaction(
      async (transaction) => {
        const current = await transaction.user.findUnique({
          where: { id: params.id },
          select: { id: true, userRole: true, status: true },
        });

        if (!current) {
          throw new NotFoundException('Usuario no encontrado');
        }

        if (dto.status === UserStatus.INACTIVE) {
          await this.ensureAdminRemains(transaction, current);
        }

        const user = await transaction.user.update({
          where: { id: params.id },
          data: { status: dto.status },
          select: USER_SELECT,
        });

        if (dto.status === UserStatus.INACTIVE) {
          await transaction.refreshToken.deleteMany({
            where: { userId: params.id },
          });
        }

        await transaction.auditLog.create({
          data: {
            action: 'UPDATE',
            entity: 'User',
            entityId: user.id,
            userId: actorId,
            oldData: { status: current.status },
            newData: { status: user.status },
          },
        });
        return user;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async changePassword(
    params: UserIdParamDto,
    dto: AdminChangePasswordDto,
  ): Promise<MessageResponse> {
    const password = await bcrypt.hash(dto.password, 12);

    await this.db.$transaction(async (transaction) => {
      const updated = await transaction.user.updateMany({
        where: { id: params.id },
        data: { password },
      });

      if (updated.count !== 1) {
        throw new NotFoundException('Usuario no encontrado');
      }

      await transaction.refreshToken.deleteMany({
        where: { userId: params.id },
      });
    });

    return { message: 'Contraseña actualizada correctamente' };
  }

  private async ensureUniqueIdentity(
    username?: string,
    dni?: string,
    excludedUserId?: string,
  ): Promise<void> {
    const [usernameOwner, dniOwner] = await Promise.all([
      username
        ? this.db.user.findUnique({
            where: { username },
            select: { id: true },
          })
        : null,
      dni
        ? this.db.user.findUnique({
            where: { dni },
            select: { id: true },
          })
        : null,
    ]);

    if (usernameOwner && usernameOwner.id !== excludedUserId) {
      throw new ConflictException('El username ya esta registrado');
    }

    if (dniOwner && dniOwner.id !== excludedUserId) {
      throw new ConflictException('El DNI ya esta registrado');
    }
  }

  private async ensureAdminRemains(
    transaction: Prisma.TransactionClient,
    current: { userRole: UserRole; status: UserStatus },
  ): Promise<void> {
    if (
      current.userRole !== UserRole.ADMIN ||
      current.status !== UserStatus.ACTIVE
    ) {
      return;
    }

    const activeAdmins = await transaction.user.count({
      where: { userRole: UserRole.ADMIN, status: UserStatus.ACTIVE },
    });

    if (activeAdmins <= 1) {
      throw new ConflictException(
        'No se puede desactivar o cambiar el rol del ultimo administrador activo',
      );
    }
  }

  private rethrowUniqueConstraint(error: unknown): void {
    if (this.isUniqueConstraintError(error)) {
      throw new ConflictException('El username o DNI ya esta registrado');
    }
  }

  private isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
