import { PaymentMethodCode } from '@/generated/prisma/enums';

export interface PaymentMethodResponse {
  id: string;
  code: PaymentMethodCode;
  name: string;
  active: boolean;
  sortOrder: number;
  paymentCount: number;
  createdAt: Date;
  updatedAt: Date;
}
