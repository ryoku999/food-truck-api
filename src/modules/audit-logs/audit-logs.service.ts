import { DatabaseService } from '@/database/database.service';
import type { Prisma } from '@/generated/prisma/client';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogQueryDto } from './audit-logs.dto';

const summarySelect = {
  id: true,
  action: true,
  entity: true,
  entityId: true,
  description: true,
  userId: true,
  user: { select: { id: true, username: true } },
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

const detailSelect = {
  ...summarySelect,
  oldData: true,
  newData: true,
  ipAddress: true,
  userAgent: true,
} satisfies Prisma.AuditLogSelect;

export type AuditLogDetailResponse = Prisma.AuditLogGetPayload<{
  select: typeof detailSelect;
}>;
export interface PaginatedAuditLogsResponse {
  items: Prisma.AuditLogGetPayload<{ select: typeof summarySelect }>[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class AuditLogsService {
  constructor(private readonly db: DatabaseService) {}

  async list(query: AuditLogQueryDto): Promise<PaginatedAuditLogsResponse> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (
      (from && !Number.isFinite(from.getTime())) ||
      (to && !Number.isFinite(to.getTime())) ||
      (from && to && from >= to)
    ) {
      throw new BadRequestException(
        'El rango requiere fechas válidas y from anterior a to',
      );
    }
    const where: Prisma.AuditLogWhereInput = {
      action: query.action,
      userId: query.userId,
      entity: query.entity,
      entityId: query.entityId,
      createdAt: { gte: from, lt: to },
    };
    const [items, total] = await this.db.$transaction(
      [
        this.db.auditLog.findMany({
          where,
          select: summarySelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: query.offset,
          take: query.limit,
        }),
        this.db.auditLog.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, offset: query.offset, limit: query.limit };
  }

  async detail(id: string): Promise<AuditLogDetailResponse> {
    const log = await this.db.auditLog.findUnique({
      where: { id },
      select: detailSelect,
    });
    if (!log)
      throw new NotFoundException('Registro de auditoría no encontrado');
    return log;
  }
}
