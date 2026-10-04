import { ModifierSelectionType } from '@/generated/prisma/enums';

export interface ModifierOptionResponse {
  id: string;
  modifierGroupId: string;
  name: string;
  priceDelta: string;
  active: boolean;
  available: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModifierGroupResponse {
  id: string;
  name: string;
  description: string | null;
  selectionType: ModifierSelectionType;
  minSelections: number;
  maxSelections: number | null;
  required: boolean;
  active: boolean;
  sortOrder: number;
  productCount: number;
  options: ModifierOptionResponse[];
  createdAt: Date;
  updatedAt: Date;
}
