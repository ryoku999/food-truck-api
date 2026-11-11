import { DatabaseService } from '@/database/database.service';
import type { Prisma } from '@/generated/prisma/client';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { PaymentMethodIdParamDto } from './dto/payment-method-id-param.dto';
import { PaymentMethodQueryDto } from './dto/payment-method-query.dto';
import { UpdatePaymentMethodStatusDto } from './dto/update-payment-method-status.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { PaymentMethodResponse } from './interfaces/payment-method.interface';

const PAYMENT_METHOD_SELECT = {
  id: true,
  code: true,
  name: true,
  active: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { payments: true } },
} satisfies Prisma.PaymentMethodSelect;

type PaymentMethodRecord = Prisma.PaymentMethodGetPayload<{
  select: typeof PAYMENT_METHOD_SELECT;
}>;

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly db: DatabaseService) {}

  async create(dto: CreatePaymentMethodDto): Promise<PaymentMethodResponse> {
    try {
      const method = await this.db.paymentMethod.create({
        data: dto,
        select: PAYMENT_METHOD_SELECT,
      });
      return this.toResponse(method);
    } catch (error: unknown) {
      this.rethrowCodeConflict(error);
      throw error;
    }
  }

  async findAll(
    query: PaymentMethodQueryDto,
  ): Promise<PaymentMethodResponse[]> {
    const methods = await this.db.paymentMethod.findMany({
      where: {
        code: query.code,
        active: query.active,
        ...(query.search
          ? { name: { contains: query.search, mode: 'insensitive' } }
          : {}),
      },
      select: PAYMENT_METHOD_SELECT,
      orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return methods.map((method) => this.toResponse(method));
  }

  async findOne(
    params: PaymentMethodIdParamDto,
  ): Promise<PaymentMethodResponse> {
    const method = await this.db.paymentMethod.findUnique({
      where: { id: params.id },
      select: PAYMENT_METHOD_SELECT,
    });
    if (!method) throw new NotFoundException('Metodo de pago no encontrado');
    return this.toResponse(method);
  }

  async update(
    params: PaymentMethodIdParamDto,
    dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodResponse> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
    try {
      const updated = await this.db.paymentMethod.updateMany({
        where: { id: params.id },
        data: dto,
      });
      if (updated.count !== 1) {
        throw new NotFoundException('Metodo de pago no encontrado');
      }
      return this.findOne(params);
    } catch (error: unknown) {
      this.rethrowCodeConflict(error);
      throw error;
    }
  }

  async updateStatus(
    params: PaymentMethodIdParamDto,
    dto: UpdatePaymentMethodStatusDto,
  ): Promise<PaymentMethodResponse> {
    const updated = await this.db.paymentMethod.updateMany({
      where: { id: params.id },
      data: { active: dto.active },
    });
    if (updated.count !== 1) {
      throw new NotFoundException('Metodo de pago no encontrado');
    }
    return this.findOne(params);
  }

  private toResponse(method: PaymentMethodRecord): PaymentMethodResponse {
    const { _count, ...data } = method;
    return { ...data, paymentCount: _count.payments };
  }

  private rethrowCodeConflict(error: unknown): void {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ya existe un metodo de pago con ese codigo');
    }
  }
}
