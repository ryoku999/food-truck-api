import z from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(8000),
  DATABASE_URL: z.string(),
  API_PREFIX: z.string(),
  CORS_ORIGINS: z.string(),
  RATE_LIMIT_LIMIT: z.coerce.number().positive(),
  RATE_LIMIT_TTL: z.coerce.number().positive(),
  AUTH_ACCESS_COOKIE_NAME: z.string(),
  AUTH_REFRESH_COOKIE_NAME: z.string(),
  AUTH_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true'),
  AUTH_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  JWT_EXPIRES_IN: z.string(),
  JWT_REFRESH_EXPIRES_IN: z.string(),
  JWT_SECRET: z.string(),
  JWT_ISSUER: z.string(),
  JWT_AUDIENCE: z.string(),
  MINIO_ROOT_USER: z.string().min(1),
  MINIO_ROOT_PASSWORD: z.string().min(8),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().int().positive(),
  MINIO_USE_SSL: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true'),
  MINIO_BUSINESS_BUCKET: z.string().min(3),
  MINIO_PRODUCTS_BUCKET: z.string().min(3),
  MINIO_PRESIGNED_URL_EXPIRY_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(604800)
    .default(900),
  MINIO_MAX_IMAGE_SIZE: z.coerce.number().int().positive().default(5_242_880),
});
