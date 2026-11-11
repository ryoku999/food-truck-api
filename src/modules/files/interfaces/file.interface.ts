import { FileType } from '@/generated/prisma/enums';

export interface FileResponse {
  id: string;
  type: FileType;
  originalName: string;
  mimeType: string | null;
  size: number | null;
  createdAt: Date;
}

export interface FileUrlResponse {
  url: string;
  expiresInSeconds: number;
}

export interface DeleteFileResponse {
  message: string;
}
