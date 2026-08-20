import 'dotenv/config';
import { buildApp } from './app.js';
import { getConfig } from './config.js';
import { createDb } from './db/client.js';

const config = getConfig();
const connection = createDb(config);
const app = await buildApp(config, connection.db);
app.addHook('onClose', async () => connection.close());

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
