import {
  CashMovementType,
  CashSessionStatus,
  PaymentMethodCode,
} from '@/generated/prisma/enums';

export interface CashCollectionsResponse {
  total: string;
  cash: string;
  nonCash: string;
  cancelled: string;
  refunded: string;
  methods: {
    id: string;
    code: PaymentMethodCode;
    name: string;
    amount: string;
    count: number;
    cancelled: string;
    refunded: string;
  }[];
}

export interface CashRegisterResponse {
  id: string;
  name: string;
  active: boolean;
  sessionCount: number;
  currentSession: {
    id: string;
    openedAt: Date;
    openedBy: { id: string; username: string };
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CashMovementResponse {
  id: string;
  cashSessionId: string;
  type: CashMovementType;
  amount: string;
  description: string | null;
  paymentId: string | null;
  user: { id: string; username: string } | null;
  createdAt: Date;
}

export interface CashSessionResponse {
  id: string;
  cashRegisterId: string;
  cashRegister: { id: string; name: string; active: boolean };
  status: CashSessionStatus;
  openingAmount: string;
  expectedAmount: string | null;
  actualAmount: string | null;
  difference: string | null;
  liveExpectedAmount: string;
  openedBy: { id: string; username: string };
  closedBy: { id: string; username: string } | null;
  openedAt: Date;
  closedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  summary: Record<CashMovementType, string>;
  collections: CashCollectionsResponse;
  movements: CashMovementResponse[];
}
