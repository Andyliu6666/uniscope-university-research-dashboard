import { timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {
  admissionsQuerySchema,
  ibQuerySchema,
  universityInputSchema,
  universityQuerySchema,
} from '@urd/shared';
import Fastify from 'fastify';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { getUniversityIb } from './services/ib-service.js';
import {
  getUniversity,
  getUniversityAdmissions,
  healthcheck,
  listUniversities,
  upsertUniversity,
} from './services/university-service.js';

export const buildApp = async (config: Config, db: Database) => {
  const app = Fastify({
    logger: config.NODE_ENV !== 'test',
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1_000_000,
  });
  await app.register(helmet);
  await app.register(cors, { origin: config.WEB_ORIGIN.split(',').map((item) => item.trim()) });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.get('/health', async () => {
    await healthcheck(db);
    return { status: 'ok' };
  });

  app.get('/api/universities', async (request, reply) => {
    const parsed = universityQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    return listUniversities(db, parsed.data);
  });

  app.get<{ Params: { slug: string } }>('/api/universities/:slug', async (request, reply) => {
    const item = await getUniversity(db, request.params.slug);
    return item ?? reply.status(404).send({ error: 'University not found' });
  });

  app.get<{ Params: { slug: string } }>(
    '/api/universities/:slug/admissions',
    async (request, reply) => {
      const parsed = admissionsQuerySchema.safeParse(request.query);
      if (!parsed.success)
        return reply
          .status(400)
          .send({ error: 'Invalid admissions query', details: parsed.error.flatten() });
      const item = await getUniversityAdmissions(db, request.params.slug, parsed.data);
      return item ?? reply.status(404).send({ error: 'University not found' });
    },
  );

  app.get<{ Params: { slug: string } }>('/api/universities/:slug/ib', async (request, reply) => {
    const query = ibQuerySchema.safeParse(request.query);
    if (!query.success)
      return reply
        .status(400)
        .send({ error: 'Invalid IB requirements query', details: query.error.flatten() });
    const result = await getUniversityIb(db, request.params.slug, query.data);
    return result ?? reply.status(404).send({ error: 'University not found' });
  });

  if (config.ADMIN_WRITES_ENABLED) {
    const adminKey = config.ADMIN_KEY;
    if (!adminKey) throw new Error('ADMIN_KEY is required when admin writes are enabled.');
    app.put(
      '/api/admin/universities',
      { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const providedKey = request.headers['x-admin-key'];
        const providedBuffer =
          typeof providedKey === 'string' ? Buffer.from(providedKey) : Buffer.alloc(0);
        const expectedBuffer = Buffer.from(adminKey);
        const validKey =
          providedBuffer.length === expectedBuffer.length &&
          timingSafeEqual(providedBuffer, expectedBuffer);
        if (!validKey) return reply.status(401).send({ error: 'Invalid admin key' });
        const parsed = universityInputSchema.safeParse(request.body);
        if (!parsed.success)
          return reply
            .status(400)
            .send({ error: 'Invalid university data', details: parsed.error.flatten() });
        const slug = await upsertUniversity(db, parsed.data);
        return reply.status(201).send({ slug });
      },
    );
  }

  app.setErrorHandler((error, _request, reply) => {
    if ((error as { code?: string }).code === '23505')
      return reply.status(409).send({ error: 'A record with this slug already exists' });
    app.log.error(error);
    return reply.status(500).send({ error: 'Unexpected server error' });
  });
  return app;
};
