import {
  OrderItemStatus,
  OrderStatus,
  ProductionAreaCode,
} from '@/generated/prisma/enums';

export interface ProductionQueueModifierResponse {
  groupName: string;
  optionName: string;
  quantity: number;
}

export interface ProductionQueueComboResponse {
  groupName: string;
  productName: string;
}

export interface ProductionQueueItemResponse {
  id: string;
  orderId: string;
  orderNumber: number;
  orderStatus: OrderStatus;
  tables: Array<{
    id: string;
    number: number;
    name: string | null;
    diningAreaName: string;
  }>;
  quantity: number;
  productName: string;
  variantName: string | null;
  modifiers: ProductionQueueModifierResponse[];
  comboSelections: ProductionQueueComboResponse[];
  notes: string | null;
  status: OrderItemStatus;
  productionArea: ProductionAreaCode;
  sentAt: Date | null;
  preparingAt: Date | null;
  readyAt: Date | null;
  servedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  elapsedSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedProductionQueueResponse {
  items: ProductionQueueItemResponse[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}
