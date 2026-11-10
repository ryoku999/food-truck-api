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
  RUSTFS_ACCESS_KEY: z.string().min(1),
  RUSTFS_SECRET_KEY: z.string().min(8),
  RUSTFS_REGION: z.string().min(1).default('us-east-1'),
  RUSTFS_PUBLIC_ENDPOINT: z.url().refine((value) => {
    const endpoint = URL.parse(value);
    return (
      endpoint !== null &&
      ['http:', 'https:'].includes(endpoint.protocol) &&
      endpoint.pathname === '/' &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash
    );
  }, 'Debe ser una URL HTTP(S) del servicio S3, sin ruta ni credenciales'),
  RUSTFS_BUSINESS_BUCKET: z.string().min(3).default('business'),
  RUSTFS_PRODUCTS_BUCKET: z.string().min(3).default('products'),
  RUSTFS_PRESIGNED_URL_EXPIRY_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(604800)
    .default(900),
  RUSTFS_MAX_IMAGE_SIZE: z.coerce.number().int().positive().default(5_242_880),
});
