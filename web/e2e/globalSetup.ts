// Before the suite: the APISIX the suite points at must answer, and holds exactly the seed data.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Admin } from './admin';
import { env } from './env';

const SEED = fileURLToPath(new URL('../../dev/seed.mjs', import.meta.url));

export default async function globalSetup(): Promise<void> {
  const admin = new Admin();
  let reply;
  try {
    reply = await admin.request('GET', 'routes');
  } catch (err) {
    throw new Error(
      `The end-to-end suite needs APISIX's Admin API at ${env.adminUrl}, and nothing answered there (${String((err as Error).cause ?? err)}).\n` +
        'Start the dev stack with `make dev-up` (or `docker compose -f dev/compose.yaml up -d`), ' +
        'or point E2E_ADMIN_URL (and the other E2E_* variables in web/playwright.config.ts) at another APISIX.',
      { cause: err },
    );
  }
  if (reply.status !== 200 || !Array.isArray(reply.body.list)) {
    throw new Error(`${env.adminUrl} does not answer like APISIX's Admin API with the key in E2E_ADMIN_KEY (HTTP ${reply.status}).`);
  }
  execFileSync(process.execPath, [SEED, '--reset'], {
    env: { ...process.env, APISIX_ADMIN_URL: env.adminUrl, APISIX_ADMIN_KEY: env.adminKey },
    stdio: 'inherit',
  });
  // The teardown compares against these: every spec leaves the seed as it found it, in number and
  // in content.
  process.env.E2E_SEED_COUNTS = JSON.stringify(await admin.counts());
  process.env.E2E_SEED_OBJECTS = JSON.stringify(await admin.snapshot());
}
