export interface ProductImageResponse {
  id: string;
  fileId: string;
  originalName: string;
  mimeType: string | null;
  size: number | null;
  isPrimary: boolean;
  sortOrder: number;
  url: string;
}

export interface ProductVariantResponse {
  id: string;
  productId: string;
  name: string;
  price: string;
  active: boolean;
  available: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductModifierOptionResponse {
  id: string;
  name: string;
  priceDelta: string;
  active: boolean;
  available: boolean;
  sortOrder: number;
}

export interface ProductModifierGroupResponse {
  id: string;
  name: string;
  description: string | null;
  selectionType: string;
  minSelections: number;
  maxSelections: number | null;
  required: boolean;
  active: boolean;
  sortOrder: number;
  options: ProductModifierOptionResponse[];
}

export interface ComboGroupItemResponse {
  id: string;
  productId: string;
  productNameSnapshot: string;
  additionalPrice: string;
  active: boolean;
  sortOrder: number;
}

export interface ComboGroupResponse {
  id: string;
  comboProductId: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  sortOrder: number;
  items: ComboGroupItemResponse[];
}

export interface ProductDetailResponse {
  id: string;
  category: { id: string; name: string; active: boolean };
  productionArea: {
    id: string;
    name: string;
    code: string;
    active: boolean;
  } | null;
  name: string;
  description: string | null;
  basePrice: string;
  active: boolean;
  available: boolean;
  featured: boolean;
  sortOrder: number;
  images: ProductImageResponse[];
  variants: ProductVariantResponse[];
  modifierGroups: ProductModifierGroupResponse[];
  comboGroups: ComboGroupResponse[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedProductsResponse {
  items: ProductDetailResponse[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

export interface MenuCategoryResponse {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  products: ProductDetailResponse[];
}

export interface MenuResponse {
  categories: MenuCategoryResponse[];
}

export interface MessageResponse {
  message: string;
}
