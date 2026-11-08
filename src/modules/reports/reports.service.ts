import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CashSessionsReportDto,
  ProductsReportDto,
  ReportRangeDto,
  SalesReportDto,
} from './reports.dto';

const dayMs = 86_400_000;
const localDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const money = (value: Prisma.Decimal | null) => value?.toFixed(2) ?? '0.00';

@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  private range(query: ReportRangeDto) {
    // Lima observes UTC-05:00 throughout the supported date range.
    const gte = new Date(query.from + 'T00:00:00-05:00');
    const lt = new Date(
      new Date(query.to + 'T00:00:00-05:00').getTime() + dayMs,
    );
    const days = (lt.getTime() - gte.getTime()) / dayMs;
    if (!Number.isFinite(days) || days < 1 || days > 366) {
      throw new BadRequestException('Indica un rango válido de hasta 366 días');
    }
    return { gte, lt };
  }

  private async payments(query: ReportRangeDto) {
    return this.db.payment.findMany({
      where: {
        paidAt: this.range(query),
        status: { in: ['COMPLETED', 'CANCELLED', 'REFUNDED'] },
      },
      select: {
        paidAt: true,
        status: true,
        amount: true,
        orderId: true,
        order: {
          select: {
            status: true,
            createdById: true,
            createdBy: { select: { username: true } },
          },
        },
        paymentMethod: { select: { id: true, code: true, name: true } },
      },
    });
  }

  private totals(rows: Awaited<ReturnType<ReportsService['payments']>>) {
    let collected = new Prisma.Decimal(0);
    let cancelled = new Prisma.Decimal(0);
    let refunded = new Prisma.Decimal(0);
    let paymentCount = 0;
    const orders = new Set<string>();
    for (const row of rows) {
      if (row.status === 'CANCELLED') cancelled = cancelled.add(row.amount);
      if (row.status === 'REFUNDED') refunded = refunded.add(row.amount);
      if (
        row.status === 'COMPLETED' &&
        row.order.status !== 'DRAFT' &&
        row.order.status !== 'CANCELLED'
      ) {
        collected = collected.add(row.amount);
        paymentCount++;
        orders.add(row.orderId);
      }
    }
    return {
      collected: money(collected),
      cancelled: money(cancelled),
      refunded: money(refunded),
      paymentCount,
      orderCount: orders.size,
    };
  }

  private group<Row, Key>(rows: Row[], key: (row: Row) => Key) {
    const groups = new Map<Key, Row[]>();
    for (const row of rows) {
      const group = key(row);
      const existing = groups.get(group);
      if (existing) existing.push(row);
      else groups.set(group, [row]);
    }
    return [...groups.entries()];
  }

  async dashboard(query: ReportRangeDto) {
    const openedAt = this.range(query);
    const [rows, cancelledOrders, openOrders] = await Promise.all([
      this.payments(query),
      this.db.order.count({ where: { openedAt, status: 'CANCELLED' } }),
      this.db.order.count({
        where: {
          openedAt,
          status: { in: ['SENT', 'IN_PROGRESS', 'READY', 'SERVED'] },
        },
      }),
    ]);
    return { ...this.totals(rows), cancelledOrders, openOrders };
  }

  async sales(query: SalesReportDto) {
    const rows = await this.payments(query);
    const items = this.group(rows, (row) =>
      localDate.format(row.paidAt).slice(0, query.groupBy === 'month' ? 7 : 10),
    )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([period, group]) => ({ period, ...this.totals(group) }));
    return { groupBy: query.groupBy, items, totals: this.totals(rows) };
  }

  async products(query: ProductsReportDto) {
    const paidAt = this.range(query);
    const items = await this.db.orderItem.groupBy({
      by: ['productId', 'productNameSnapshot'],
      where: {
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        order: {
          status: 'PAID',
          paidAt,
          payments: { some: { status: 'COMPLETED' } },
        },
      },
      _sum: { quantity: true, subtotal: true },
      orderBy: [
        { _sum: { quantity: 'desc' } },
        { productNameSnapshot: 'asc' },
        { productId: 'asc' },
      ],
      take: query.limit,
    });
    return {
      items: items.map((item) => ({
        productId: item.productId,
        name: item.productNameSnapshot,
        quantity: item._sum.quantity ?? 0,
        subtotal: money(item._sum.subtotal),
      })),
    };
  }

  async waiters(query: ReportRangeDto) {
    const rows = await this.payments(query);
    return {
      items: this.group(rows, (row) => row.order.createdById)
        .map(([userId, group]) => ({
          userId,
          username: group[0].order.createdBy?.username ?? null,
          ...this.totals(group),
        }))
        .sort(
          (left, right) =>
            new Prisma.Decimal(right.collected).cmp(left.collected) ||
            (left.userId ?? '').localeCompare(right.userId ?? ''),
        ),
    };
  }

  async paymentMethods(query: ReportRangeDto) {
    const rows = await this.payments(query);
    return {
      items: this.group(rows, (row) => row.paymentMethod.id)
        .map(([, group]) => ({
          ...group[0].paymentMethod,
          ...this.totals(group),
        }))
        .sort((left, right) => left.code.localeCompare(right.code)),
      totals: this.totals(rows),
    };
  }

  async cashSessions(query: CashSessionsReportDto) {
    const rows = await this.db.cashRegisterSession.findMany({
      where: {
        status: 'CLOSED',
        closedAt: this.range(query),
        cashRegisterId: query.cashRegisterId,
      },
      orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        openedAt: true,
        closedAt: true,
        openingAmount: true,
        expectedAmount: true,
        actualAmount: true,
        difference: true,
        cashRegister: { select: { id: true, name: true } },
      },
    });
    return {
      items: rows.map(
        ({
          openingAmount,
          expectedAmount,
          actualAmount,
          difference,
          ...row
        }) => ({
          ...row,
          openingAmount: money(openingAmount),
          expectedAmount: expectedAmount?.toFixed(2) ?? null,
          actualAmount: actualAmount?.toFixed(2) ?? null,
          difference: difference?.toFixed(2) ?? null,
        }),
      ),
    };
  }
}
