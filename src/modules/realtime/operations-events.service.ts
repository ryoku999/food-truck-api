import { UserRole } from '@/generated/prisma/enums';
import { Injectable } from '@nestjs/common';
import {
  OPERATIONS_EVENTS,
  OperationsEvent,
} from './interfaces/operations-event.interface';
import { OperationsGateway } from './operations.gateway';

const FRONT_OPERATION_ROLES: UserRole[] = [
  UserRole.WAITER,
  UserRole.CASHIER,
  UserRole.ADMIN,
  UserRole.MANAGER,
];

@Injectable()
export class OperationsEventsService {
  constructor(private readonly gateway: OperationsGateway) {}

  emitOrderSent<T>(data: T): void {
    this.emitToRoles(FRONT_OPERATION_ROLES, OPERATIONS_EVENTS.ORDER_SENT, data);
  }

  emitOrderItemStatusChanged<T>(data: T): void {
    this.emitToRoles(
      FRONT_OPERATION_ROLES,
      OPERATIONS_EVENTS.ORDER_ITEM_STATUS_CHANGED,
      data,
    );
  }

  emitOrderStatusChanged<T>(data: T): void {
    this.emitToRoles(
      FRONT_OPERATION_ROLES,
      OPERATIONS_EVENTS.ORDER_STATUS_CHANGED,
      data,
    );
  }

  emitTableStatusChanged<T>(data: T): void {
    this.emitToRoles(
      FRONT_OPERATION_ROLES,
      OPERATIONS_EVENTS.TABLE_STATUS_CHANGED,
      data,
    );
  }

  emitPrintJobStatusChanged<T>(data: T, orderOwnerId?: string | null): void {
    const rooms = [UserRole.CASHIER, UserRole.ADMIN, UserRole.MANAGER].map(
      (role) => `role:${role}`,
    );
    if (orderOwnerId) rooms.push(`user:${orderOwnerId}`);
    this.emitToRooms(rooms, OPERATIONS_EVENTS.PRINT_JOB_STATUS_CHANGED, data);
  }

  private emitToRoles<T>(roles: UserRole[], event: string, data: T): void {
    this.emitToRooms(
      roles.map((role) => `role:${role}`),
      event,
      data,
    );
  }

  private emitToRooms<T>(rooms: string[], event: string, data: T): void {
    if (!this.gateway.server) return;
    const payload: OperationsEvent<T> = {
      occurredAt: new Date().toISOString(),
      data,
    };
    this.gateway.server.to([...new Set(rooms)]).emit(event, payload);
  }
}
