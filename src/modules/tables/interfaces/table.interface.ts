import { OrderStatus, TableStatus } from '@/generated/prisma/enums';

export interface TableDiningAreaResponse {
  id: string;
  name: string;
}

export interface TableResponse {
  id: string;
  diningArea: TableDiningAreaResponse;
  number: number;
  name: string | null;
  capacity: number | null;
  status: TableStatus;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface JoinedTableResponse {
  id: string;
  number: number;
  name: string | null;
  diningArea: TableDiningAreaResponse;
}

export interface TableOpenOrderResponse {
  id: string;
  number: number;
  status: OrderStatus;
  total: string;
  openedAt: Date;
  joinedTables: JoinedTableResponse[];
}

export interface TableDetailResponse extends TableResponse {
  openOrder: TableOpenOrderResponse | null;
}

export interface TableMapItemResponse {
  id: string;
  number: number;
  name: string | null;
  capacity: number | null;
  status: TableStatus;
  active: boolean;
  sortOrder: number;
  openOrder: TableOpenOrderResponse | null;
}

export interface TableMapAreaResponse {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
  tables: TableMapItemResponse[];
}

export interface TableMapResponse {
  areas: TableMapAreaResponse[];
}
