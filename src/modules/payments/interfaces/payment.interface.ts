import {
  CashMovementType,
  OrderStatus,
  PaymentMethodCode,
  PaymentStatus,
} from '@/generated/prisma/enums';

export interface PaymentResponse {
  id: string;
  orderId: string;
  orderNumber: number;
  orderStatus: OrderStatus;
  paymentMethod: {
    id: string;
    code: PaymentMethodCode;
    name: string;
  };
  amount: string;
  status: PaymentStatus;
  reference: string | null;
  notes: string | null;
  user: { id: string; username: string } | null;
  cashMovement: {
    id: string;
    cashSessionId: string;
    type: CashMovementType;
    amount: string;
    description: string | null;
  } | null;
  paidAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderPaymentsResponse {
  items: PaymentResponse[];
  summary: {
    orderTotal: string;
    paid: string;
    pending: string;
  };
}
