import {
  OrderItemStatus,
  OrderStatus,
  OrderType,
  ProductionAreaCode,
} from '@/generated/prisma/enums';

export interface OrderTableResponse {
  id: string;
  number: number;
  name: string | null;
  diningArea: { id: string; name: string };
  joinedAt: Date;
}

export interface OrderItemModifierResponse {
  id: string;
  modifierOptionId: string | null;
  groupNameSnapshot: string;
  optionNameSnapshot: string;
  priceDelta: string;
  quantity: number;
}

export interface OrderItemComboSelectionResponse {
  id: string;
  comboGroupItemId: string | null;
  groupNameSnapshot: string;
  productNameSnapshot: string;
  additionalPrice: string;
}

export interface OrderItemResponse {
  id: string;
  productId: string | null;
  productVariantId: string | null;
  productNameSnapshot: string;
  variantNameSnapshot: string | null;
  quantity: number;
  unitPrice: string;
  modifiersPrice: string;
  subtotal: string;
  notes: string | null;
  status: OrderItemStatus;
  productionArea: ProductionAreaCode;
  sentAt: Date | null;
  roundNumber: number | null;
  preparingAt: Date | null;
  readyAt: Date | null;
  servedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdBy: { id: string; username: string } | null;
  cancelledBy: { id: string; username: string } | null;
  modifiers: OrderItemModifierResponse[];
  comboSelections: OrderItemComboSelectionResponse[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderDetailResponse {
  id: string;
  number: number;
  type: OrderType;
  status: OrderStatus;
  customerName: string | null;
  customerPhone: string | null;
  notes: string | null;
  subtotal: string;
  discount: string;
  total: string;
  createdBy: { id: string; username: string } | null;
  closedBy: { id: string; username: string } | null;
  tables: OrderTableResponse[];
  items: OrderItemResponse[];
  openedAt: Date;
  sentAt: Date | null;
  closedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedOrdersResponse {
  items: OrderDetailResponse[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

export interface OrderSummaryResponse {
  id: string;
  number: number;
  status: OrderStatus;
  subtotal: string;
  discount: string;
  total: string;
  paid: string;
  pending: string;
  itemCount: number;
  cancelledItemCount: number;
}
