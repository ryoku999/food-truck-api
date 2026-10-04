import { TableStatus } from '@/generated/prisma/enums';

export interface DiningAreaTableResponse {
  id: string;
  number: number;
  name: string | null;
  capacity: number | null;
  status: TableStatus;
  active: boolean;
  sortOrder: number;
}

export interface DiningAreaResponse {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  tableCount: number;
  activeTableCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiningAreaDetailResponse extends DiningAreaResponse {
  tables: DiningAreaTableResponse[];
}
