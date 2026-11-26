import 'reflect-metadata';
import { DatabaseService } from '@/database/database.service';
import { UserRole, UserStatus } from '@/generated/prisma/enums';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './dto/create-user.dto';

async function bootstrapAdmin() {
  const dto = plainToInstance(CreateUserDto, {
    username: process.env.BOOTSTRAP_ADMIN_USERNAME,
    dni: process.env.BOOTSTRAP_ADMIN_DNI,
    firstName: process.env.BOOTSTRAP_ADMIN_FIRST_NAME,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    userRole: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
  });
  const errors = await validate(dto);
  if (errors.length) {
    throw new Error(
      errors
        .flatMap(({ constraints }) => Object.values(constraints ?? {}))
        .join('\n'),
    );
  }
  if (Buffer.byteLength(dto.password, 'utf8') > 72) {
    throw new Error('La contraseña debe ocupar como máximo 72 bytes.');
  }

  const password = await bcrypt.hash(dto.password, 12);
  const db = new DatabaseService(new ConfigService());
  try {
    const created = await db.$transaction(
      async (tx) => {
        const existing = await tx.user.findFirst({
          where: { userRole: UserRole.ADMIN, status: UserStatus.ACTIVE },
          select: { id: true },
        });
        if (existing) return false;
        const user = await tx.user.create({
          data: {
            username: dto.username,
            dni: dto.dni,
            firstName: dto.firstName,
            password,
            userRole: UserRole.ADMIN,
            status: UserStatus.ACTIVE,
          },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            action: 'CREATE',
            entity: 'User',
            entityId: user.id,
            userId: user.id,
            description: 'Creación del administrador inicial',
          },
        });
        return true;
      },
      { isolationLevel: 'Serializable' },
    );
    console.log(
      created
        ? 'Administrador inicial creado.'
        : 'Ya existe un administrador activo.',
    );
  } finally {
    await db.onModuleDestroy();
  }
}

void bootstrapAdmin().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Falló el alta del administrador.',
  );
  process.exitCode = 1;
});
