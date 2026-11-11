import { ProductionAreaCode } from '@/generated/prisma/enums';

export interface ProductionAreaResponse {
  id: string;
  name: string;
  code: ProductionAreaCode;
  active: boolean;
  counts: {
    categories: number;
    products: number;
    printers: number;
  };
  createdAt: Date;
  updatedAt: Date;
}
