import { DatabaseService } from '@/database/database.service';
import { ConflictException, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateUserResponse } from './interfaces/user.interface';

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async create(dto: CreateUserDto): Promise<CreateUserResponse> {
    const duplicate = await this.db.user.findFirst({
      where: {
        OR: [{ username: dto.username }, { dni: dto.dni }],
      },
      select: { username: true, dni: true },
    });

    if (duplicate?.username === dto.username) {
      throw new ConflictException('El username ya esta registrado');
    }

    if (duplicate?.dni === dto.dni) {
      throw new ConflictException('El DNI ya esta registrado');
    }

    const password = await bcrypt.hash(dto.password, 12);

    try {
      return await this.db.user.create({
        data: {
          username: dto.username,
          dni: dto.dni,
          password,
          firstName: dto.firstName,
          lastName: dto.lastName,
          userRole: dto.userRole,
          status: dto.status,
        },
        select: {
          id: true,
          username: true,
          dni: true,
          firstName: true,
          lastName: true,
          userRole: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('El username o DNI ya esta registrado');
      }

      throw error;
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
