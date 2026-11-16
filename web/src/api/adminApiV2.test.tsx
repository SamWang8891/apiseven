// APISIX 3.x answers in the Admin API's v2 format when `deployment.admin.admin_api_version` is not
// `v3` (apisix/admin/v3_adapter.lua: enable_v3, filter; apisix/core/etcd.lua: get_format): each
// answer is wrapped in `node`, a list is etcd's directory node with its entries in `node.nodes`, and
// `action` is added. apiseven reads only the v3 format; such an answer says so and names the setting.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { DEV_CONN, renderApp, resetApp, saveConnections } from '../test/app';
import { json } from '../test/fakeAdmin';
import { AdminClient } from './client';
import { ApiError } from './errors';

afterEach(resetApp);

const ROUTE = { id: '1', uri: '/hello', upstream: { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } } };
const V2_LIST = {
  action: 'get',
  node: { key: '/apisix/routes', dir: true, nodes: [{ key: '/apisix/routes/1', value: ROUTE, createdIndex: 21, modifiedIndex: 21 }] },
};
const V2_EMPTY = { action: 'get', node: { key: '/apisix/routes', dir: true, nodes: [] } };
const V2_ITEM = { action: 'get', node: { key: '/apisix/routes/1', value: ROUTE } };

/** A client straight to APISIX whose every request is answered 200 with `body`. */
function answering(body: unknown) {
  return new AdminClient({ id: 'c1', name: 'dev', baseUrl: 'http://apisix:9180', key: 'k' }, () => Promise.resolve(json(200, body)));
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected the promise to reject');
}

describe('an Admin API answer in the v2 format', () => {
  it('fails as kind parse, marked v2Format, with a message naming the setting', async () => {
    const calls: [string, () => Promise<unknown>][] = [
      ['ping (an empty list)', () => answering(V2_EMPTY).ping()],
      ['list', () => answering(V2_LIST).list('routes')],
      ['get', () => answering(V2_ITEM).get('routes', '1')],
      ['replace', () => answering({ action: 'set', node: { key: '/apisix/routes/1', value: ROUTE } }).replace('routes', '1', ROUTE)],
    ];
    for (const [label, call] of calls) {
      const err = await failure(call());
      expect(err.kind, label).toBe('parse');
      expect(err.v2Format, label).toBe(true);
      expect(err.message, label).toBe(t('api.adminApiV2'));
      expect(err.message, label).toContain('deployment.admin.admin_api_version');
    }
  });

  // Review of wave A, minor 5: the v3 shapes themselves are explicit negatives.
  it('a v3 item and a v3 list are read, not taken for the v2 format', async () => {
    const item = await answering({ key: '/apisix/routes/1', value: ROUTE, createdIndex: 21, modifiedIndex: 21 }).get('routes', '1');
    expect(item).toMatchObject({ id: '1', value: ROUTE });
    const list = await answering({ total: 1, list: [{ key: '/apisix/routes/1', value: ROUTE, createdIndex: 21, modifiedIndex: 21 }] }).list('routes');
    expect(list.map((i) => i.id)).toEqual(['1']);
    await expect(answering({ total: 0, list: [] }).ping()).resolves.toBeDefined();
  });

  it('is told apart from an answer that is not the Admin API at all', async () => {
    for (const body of [{ status: 'ok' }, { node: 'x' }, { node: { value: ROUTE } }, { list: 'x' }]) {
      const err = await failure(answering(body).list('routes'));
      expect(err.kind).toBe('parse');
      expect(err.v2Format).toBeUndefined();
      expect(err.message).toBe('not an APISIX Admin API response');
    }
  });
});

describe('a list page, when APISIX answers in the v2 format', () => {
  it('names the setting in its error', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({ hash: '#/routes', replies: { routes: () => json(200, V2_LIST) } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('api.adminApiV2'));
  });
});

describe('the Connect page, when APISIX answers in the v2 format', () => {
  it('says so and names admin_api_version, instead of "not an APISIX Admin API"', async () => {
    const user = userEvent.setup();
    renderApp({ hash: '#/connect', replies: { routes: () => json(200, V2_EMPTY) } });
    await screen.findByRole('heading', { level: 1, name: t('connect.title') });
    await user.type(screen.getByLabelText(t('connect.url')), 'http://10.1.2.3:9180');
    await user.type(screen.getByLabelText(t('connect.key'), { exact: false }), 'edd1c9f034335f136f87ad84b625c8f1');
    await user.click(screen.getByRole('button', { name: t('connect.submit') }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('connect.adminApiV2'));
    expect(alert).toHaveTextContent(t('connect.adminApiV2Hint'));
    expect(alert).toHaveTextContent('deployment.admin.admin_api_version');
    expect(alert).not.toHaveTextContent(t('connect.notAdmin', { status: 'HTTP 200' }));
    expect(window.location.hash).toBe('#/connect');
  });
});
