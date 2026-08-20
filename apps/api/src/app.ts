import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { universityInputSchema, universityQuerySchema } from '@urd/shared';
import Fastify from 'fastify';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import {
  getUniversity,
  healthcheck,
  listUniversities,
  upsertUniversity,
} from './services/university-service.js';

export const buildApp = async (config: Config, db: Database) => {
  const app = Fastify({
    logger: config.NODE_ENV !== 'test',
    trustProxy: true,
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

  app.put(
    '/api/admin/universities',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (request.headers['x-admin-key'] !== config.ADMIN_KEY)
        return reply.status(401).send({ error: 'Invalid admin key' });
      const parsed = universityInputSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .status(400)
          .send({ error: 'Invalid university data', details: parsed.error.flatten() });
      const slug = await upsertUniversity(db, parsed.data);
      return reply.status(201).send({ slug });
    },
  );

  app.setErrorHandler((error, _request, reply) => {
    if ((error as { code?: string }).code === '23505')
      return reply.status(409).send({ error: 'A record with this slug already exists' });
    app.log.error(error);
    return reply.status(500).send({ error: 'Unexpected server error' });
  });
  return app;
};
