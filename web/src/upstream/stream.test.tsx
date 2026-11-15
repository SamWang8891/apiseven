// The upstream form for a stream route's upstream (subsystem 'stream'): what applies to L4 only, and
// settings that don't apply shown only when stored, with a note, and kept as they are.
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { renderUpstream } from '../test/upstream';

const NODES = { nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] };
const notes = () => screen.queryAllByText(t('up.stream.noEffect'));

async function options(user: ReturnType<typeof renderUpstream>['user'], name: string) {
  await user.click(screen.getByRole('combobox', { name }));
  const list = await screen.findByRole('listbox');
  const shown = within(list).getAllByRole('option').map((o) => o.textContent);
  await user.keyboard('{Escape}');
  return shown;
}

describe('Connection, stream', () => {
  it('offers only the L4 schemes, tcp by default (filter_upstream, apisix/upstream.lua 763–766)', async () => {
    const h = renderUpstream(NODES, { section: 'connection', subsystem: 'stream' });
    expect(await options(h.user, t('up.conn.scheme'))).toEqual([t('up.default', { value: 'tcp' }), 'tcp', 'tls', 'udp']);
  });

  it('http (the default) is unchanged: every scheme, http by default', async () => {
    const h = renderUpstream(NODES, { section: 'connection' });
    const shown = await options(h.user, t('up.conn.scheme'));
    expect(shown[0]).toBe(t('up.default', { value: 'http' }));
    expect(shown).toContain('https');
    expect(screen.getByRole('combobox', { name: t('up.conn.passHost') })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: t('up.conn.pool') })).toBeInTheDocument();
  });

  it('does not offer pass host or the keepalive pool, which have no effect there', () => {
    renderUpstream(NODES, { section: 'connection', subsystem: 'stream' });
    expect(screen.queryByRole('combobox', { name: t('up.conn.passHost') })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: t('up.conn.pool') })).not.toBeInTheDocument();
    expect(notes()).toEqual([]);
  });

  it('a stored http setting is shown with a note, editing and locked, and stays editable and removable', async () => {
    const stored: Obj = { ...NODES, scheme: 'https', pass_host: 'node', keepalive_pool: { size: 8 } };
    const h = renderUpstream(stored, { section: 'connection', subsystem: 'stream' });
    expect(notes()).toHaveLength(3);
    expect(screen.getByRole('combobox', { name: t('up.conn.passHost') })).toBeInTheDocument();
    await h.user.clear(screen.getByRole('spinbutton', { name: t('up.conn.poolSize') }));
    expect(h.value()).toEqual({ ...NODES, scheme: 'https', pass_host: 'node' });
    h.update({ locked: true });
    expect(notes()).toHaveLength(2);
  });
});

describe('Load balancing, stream', () => {
  it('hash on: vars and vars_combinations only; slow start is not offered', async () => {
    const h = renderUpstream({ ...NODES, type: 'chash', key: 'remote_addr' }, { section: 'balancing', subsystem: 'stream' });
    expect(await options(h.user, t('up.balance.hashOn'))).toEqual([t('up.default', { value: 'vars' }), 'vars', 'vars_combinations']);
    expect(screen.queryByRole('switch', { name: t('up.warm.title') })).not.toBeInTheDocument();
  });

  it('a stored hash_on header and slow start are shown with a note; slow start can be switched off', async () => {
    const warm = { slow_start_time_seconds: 10, min_weight_percent: 1 };
    const h = renderUpstream({ ...NODES, type: 'chash', hash_on: 'header', key: 'X-User', warm_up_conf: warm }, { section: 'balancing', subsystem: 'stream' });
    expect(notes()).toHaveLength(2);
    await h.user.click(screen.getByRole('switch', { name: t('up.warm.title') }));
    expect(h.value()).toEqual({ ...NODES, type: 'chash', hash_on: 'header', key: 'X-User' });
  });
});

describe('TLS, stream', () => {
  it('certificate verification and CA certificates are not offered; the client certificate is', () => {
    renderUpstream(NODES, { section: 'tls', subsystem: 'stream' });
    expect(screen.queryByRole('combobox', { name: t('up.tls.verify') })).not.toBeInTheDocument();
    expect(screen.queryByText(t('up.tls.ca'))).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: t('up.tls.mode') })).toBeInTheDocument();
  });

  it('a stored verify is shown with a note and can be set back to the default (removed)', async () => {
    const h = renderUpstream({ ...NODES, tls: { verify: true } }, { section: 'tls', subsystem: 'stream' });
    expect(notes()).toHaveLength(1);
    await h.user.click(screen.getByRole('combobox', { name: t('up.tls.verify') }));
    await h.user.click(await screen.findByRole('option', { name: t('up.tls.verifyDefault') }));
    expect(h.value()).toEqual(NODES);
  });
});
