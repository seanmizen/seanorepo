import { buildApp } from './app';
import { openScoreStore } from './db';

const PORT = Number(process.env.PORT ?? 4071);
// In Docker, DB_PATH is on a named volume, so a redeploy keeps the scores.
const DB_PATH = process.env.DB_PATH ?? './db/scores.sqlite';

const store = openScoreStore(DB_PATH);
const app = buildApp({ store, logger: true });

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
