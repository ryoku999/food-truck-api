import type { Prisma } from '@/generated/prisma/client';

export const readyPrinter = {
  active: true,
  status: 'ACTIVE',
  printerAgent: { active: true },
} satisfies Prisma.PrinterWhereInput;

export const retryablePrintErrorPrefix = 'RETRYABLE: ';
export const uncertainPrintErrorPrefix = 'UNCERTAIN: ';
