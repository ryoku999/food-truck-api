export interface CategoryProductionAreaResponse {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

export interface CategoryImageResponse {
  id: string;
  fileId: string;
  originalName: string;
  mimeType: string | null;
  size: number | null;
  sortOrder: number;
  url: string;
}

export interface CategoryResponse {
  id: string;
  name: string;
  description: string | null;
  productionArea: CategoryProductionAreaResponse | null;
  active: boolean;
  sortOrder: number;
  productCount: number;
  images: CategoryImageResponse[];
  createdAt: Date;
  updatedAt: Date;
}
