import { z } from 'zod';

const environmentBoolean = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(String(defaultValue) as 'true' | 'false')
    .transform((value) => value === 'true');

const optionalSecret = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(16).optional(),
);

const trustProxy = z
  .string()
  .trim()
  .default('false')
  .transform((value, context): boolean | string | string[] => {
    if (value === 'false') return false;
    if (value === 'true') return true;
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'TRUST_PROXY must be true, false, or a proxy list.',
      });
      return z.NEVER;
    }
    return entries.length === 1 ? (entries[0] as string) : entries;
  });

const insecureAdminKeys = new Set(['local-development-only', 'change-me-in-production']);

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3001),
    HOST: z.string().default('127.0.0.1'),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    ADMIN_WRITES_ENABLED: environmentBoolean(false),
    ADMIN_KEY: optionalSecret,
    TRUST_PROXY: trustProxy,
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  })
  .superRefine((config, context) => {
    if (config.ADMIN_WRITES_ENABLED && !config.ADMIN_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['ADMIN_KEY'],
        message: 'ADMIN_KEY is required when ADMIN_WRITES_ENABLED=true.',
      });
    }
    if (
      config.ADMIN_WRITES_ENABLED &&
      config.NODE_ENV === 'production' &&
      config.ADMIN_KEY &&
      insecureAdminKeys.has(config.ADMIN_KEY)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ADMIN_KEY'],
        message: 'Refusing a known development ADMIN_KEY in production.',
      });
    }
  });

export type Config = z.infer<typeof envSchema>;
export const getConfig = (): Config => envSchema.parse(process.env);
