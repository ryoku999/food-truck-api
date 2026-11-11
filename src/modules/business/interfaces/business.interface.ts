export interface BusinessLogoResponse {
  id: string;
  originalName: string;
  mimeType: string | null;
  size: number | null;
  url: string;
}

export interface BusinessResponse {
  id: string;
  name: string;
  tradeName: string | null;
  description: string | null;
  documentNumber: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  currencyCode: string;
  logo: BusinessLogoResponse | null;
  createdAt: Date;
  updatedAt: Date;
}
