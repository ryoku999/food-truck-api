import type { Prisma } from '@/generated/prisma/client';
import { ConflictException } from '@nestjs/common';

export async function ensureOrderUnbilled(
  tx: Prisma.TransactionClient,
  id: string,
) {
  const billed = await tx.order.findFirst({
    where: {
      id,
      OR: [
        { billParts: { some: {} } },
        { payments: { some: { status: 'COMPLETED' } } },
      ],
    },
    select: { id: true },
  });
  if (billed)
    throw new ConflictException(
      'Anula los pagos y libera las partes antes de cancelar productos o el pedido',
    );
}
