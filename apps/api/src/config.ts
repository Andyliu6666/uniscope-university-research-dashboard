import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  ADMIN_KEY: z.string().min(16),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Config = z.infer<typeof envSchema>;
export const getConfig = (): Config => envSchema.parse(process.env);
