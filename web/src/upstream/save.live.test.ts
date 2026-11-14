// @vitest-environment node
// An upstream as the form writes it, saved to a real APISIX (dev/compose.yaml); skipped otherwise:
//   APISIX_LIVE=1 npx vitest run src/upstream/save.live.test.ts
// Env: APISIX_ADMIN_URL (default http://127.0.0.1:19180), APISIX_ADMIN_KEY (default dev admin key).
// It creates one upstream named after `tag` and removes it.
import { afterAll, describe, expect, it } from 'vitest';
import { AdminClient } from '../api/client';
import { stripTimestamps } from '../api/sanitize';
import type { Item, Obj } from '../api/types';
import { saveResource, type SaveResult } from '../editor/save';
import { upstreamIssues } from './validate';

const env = import.meta.env as Record<string, string | undefined>;
const api = new AdminClient({
  id: 'live',
  name: 'live',
  baseUrl: env.APISIX_ADMIN_URL ?? 'http://127.0.0.1:19180',
  key: env.APISIX_ADMIN_KEY ?? 'apiseven-dev-admin-key',
});
const tag = `apiseven-live-${Date.now().toString(36)}`;
const undo: (() => Promise<unknown>)[] = [];

function saved(result: SaveResult): Item {
  if (!result.ok) throw new Error(`expected a save, got ${'conflict' in result ? 'a conflict' : result.error.message}`);
  return result.item;
}

describe.skipIf(env.APISIX_LIVE !== '1')('an upstream from the form, against a live APISIX', () => {
  afterAll(async () => {
    for (const step of undo.reverse()) await step().catch(() => undefined);
  });

  it('chash + active and passive health checks + timeouts: created, read back as written, removed', async () => {
    const draft: Obj = {
      name: tag,
      type: 'chash',
      hash_on: 'header',
      key: 'X-User-Id',
      nodes: [
        { host: '127.0.0.1', port: 1980, weight: 3 },
        { host: '127.0.0.2', port: 1980, weight: 1, priority: -1 },
      ],
      checks: {
        active: { type: 'http', http_path: '/status', healthy: { interval: 2, successes: 2, http_statuses: [200] }, unhealthy: { interval: 1, http_failures: 3 } },
        passive: { unhealthy: { http_statuses: [500, 503], http_failures: 3 } },
      },
      timeout: { connect: 3, send: 60, read: 60 },
      keepalive_pool: { size: 64 },
      pass_host: 'node',
      retries: 1,
    };
    expect(upstreamIssues(draft)).toEqual([]);
    const created = saved(await saveResource(api, { kind: 'upstreams', isNew: true, draft }));
    undo.push(() => api.remove('upstreams', created.id));
    // APISIX stores what was sent (plus the id and timestamps); it fills no defaults into the stored object.
    expect(stripTimestamps(created.value)).toEqual({ ...draft, id: created.id });

    await api.remove('upstreams', created.id);
    await expect(api.get('upstreams', created.id)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps the map shape of nodes', async () => {
    const draft: Obj = { name: `${tag}-map`, type: 'roundrobin', nodes: { '127.0.0.1:1980': 1, 'localhost:1981': 2 } };
    const created = saved(await saveResource(api, { kind: 'upstreams', isNew: true, draft }));
    undo.push(() => api.remove('upstreams', created.id));
    expect(created.value.nodes).toEqual(draft.nodes);
  });
});
