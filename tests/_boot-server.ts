/**
 * The one server boot sequence for DB-backed integration tests. No top-level
 * exit and no TEST_DATABASE_URL read, so skip-gated suites may import it.
 * `fixtures` runs after the schema is ready and before the planner starts.
 */
import path from 'path';
import request from 'supertest';
import { createFestivalPlanner } from '../server';
import { ensureTestSchema } from './_test-schema';

const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');

export async function bootServer(
  databaseUrl: string,
  overrides: Record<string, any> = {},
  fixtures?: () => Promise<void>,
) {
  await ensureTestSchema(databaseUrl);
  await fixtures?.();
  const planner = await createFestivalPlanner({
    DATABASE_URL: databaseUrl,
    PUBLIC_DIR,
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
    ...overrides,
  });
  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  const address = planner.server.address() as any;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    databaseUrl,
    planner,
    request: request(planner.app),
    async close() {
      await planner.close();
    },
  };
}
