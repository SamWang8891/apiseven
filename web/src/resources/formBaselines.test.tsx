// The stored baseline a tab hands its SchemaForm keeps its identity while the user types (Task 16b,
// item 132): the form shares it with every field through a memoised context, so a new object on each
// render re-rendered every field on each keystroke. A stream route's protocol parts are JSON fields,
// which read no stored value: they get none.
import { screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { resetApp } from '../test/app';
import { itemOf } from '../test/ctx';
import { main, openEditor } from '../test/editor';
import { pluginReplies } from '../test/plugins';
import { renderTab } from '../test/tab';

/** Every SchemaForm render: the form's name and the baseline it was given. */
const seen = vi.hoisted(() => ({ forms: [] as { name: string | undefined; baseline: unknown }[] }));
vi.mock('../schema-form/SchemaForm', async (importOriginal) => {
  const real = await importOriginal<typeof import('../schema-form/SchemaForm')>();
  return {
    ...real,
    SchemaForm: (props: Parameters<typeof real.SchemaForm>[0]) => {
      seen.forms.push({ name: props.name, baseline: props.baseline });
      return createElement(real.SchemaForm, props);
    },
  };
});

beforeAll(async () => {
  await import('./secrets/bodies');
  await import('./plugin_metadata/bodies');
});

afterEach(() => {
  seen.forms.length = 0;
  resetApp();
  resetReadOnlyKeys();
});

/** The distinct baselines the named form was given since `from`. */
const baselinesOf = (name: string, from: number) => new Set(seen.forms.slice(from).filter((f) => f.name === name).map((f) => f.baseline));

describe('a tab’s SchemaForm baseline', () => {
  it('a secret manager’s settings: one baseline object while typing', async () => {
    const vault: Obj = { id: 'vault/v1', uri: 'http://127.0.0.1:8200', prefix: 'kv/apisix', token: 'hvs-stored-token' };
    const { user } = await openEditor('#/secrets/vault%2Fv1', { objects: { secrets: [vault] } });
    await main().findByRole('heading', { level: 1 });
    await user.keyboard('e');
    const prefix = await main().findByRole('textbox', { name: /^prefix/ });
    const from = seen.forms.length;
    await user.type(prefix, '2x');
    const baselines = baselinesOf('vault', from);
    expect(baselines.size).toBe(1);
    expect([...baselines][0]).toEqual({ uri: 'http://127.0.0.1:8200', prefix: 'kv/apisix', token: 'hvs-stored-token' });
  });

  it('a plugin’s metadata: one baseline object while typing', async () => {
    const stored: Obj = { id: 'http-logger', log_format: { host: '$host' } };
    const { user } = await openEditor('#/plugin_metadata/http-logger', { objects: { plugin_metadata: [stored] }, replies: pluginReplies() });
    await main().findByRole('heading', { level: 1, name: 'http-logger' });
    await user.keyboard('e');
    const field = await main().findByRole('spinbutton', { name: 'max_pending_entries' });
    const from = seen.forms.length;
    await user.type(field, '12');
    await waitFor(() => expect(baselinesOf('http-logger', from).size).toBe(1));
    expect([...baselinesOf('http-logger', from)][0]).toEqual({ log_format: { host: '$host' } });
  });

  it('a stream route’s protocol parts: none (JSON fields read no stored value)', async () => {
    const { AdvancedTab } = await import('./stream_routes/bodies');
    const { streamRouteIssues } = await import('./stream_routes/validate');
    const route: Obj = { id: 'sr1', protocol: { name: 'redis', conf: { faults: [] } } };
    const h = renderTab('stream_routes', AdvancedTab, route, streamRouteIssues, { original: itemOf('sr1', route) });
    await h.user.type(screen.getByRole('textbox', { name: t('sr.adv.protocolName') }), 'x');
    const forms = seen.forms.filter((f) => f.name === 'protocol');
    expect(forms.length).toBeGreaterThan(1);
    expect(forms.every((f) => f.baseline === undefined)).toBe(true);
  });
});
