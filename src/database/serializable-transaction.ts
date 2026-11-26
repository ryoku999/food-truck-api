import type { Prisma } from '@/generated/prisma/client';
import { ConflictException } from '@nestjs/common';
import type { DatabaseService } from './database.service';

export async function serializableTransaction<T>(
  db: DatabaseService,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'P2034'
      )) {
        throw error;
      }
      if (attempt === 3) {
        throw new ConflictException(
          'Hubo otro cambio al mismo tiempo. Actualiza los datos y vuelve a intentar.',
        );
      }
    }
  }
}
