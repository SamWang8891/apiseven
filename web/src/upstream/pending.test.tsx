// The upstream form never hides a field that holds input it has not emitted (usePending): a
// section does not collapse, and the inner tab strip does not switch, until it is fixed or cleared.
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { renderUpstream } from '../test/upstream';
import { getToasts, toastsRaised } from '../ui/toast';

const UPSTREAM = { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }], retries: 2 };
const refused = (text: string) => t('ui.pending.refused', { message: t('ui.pending.notInteger', { field: t('up.conn.retries'), text }) });

describe('held input in the upstream form', () => {
  it('a section does not collapse while a field in it holds input', async () => {
    const form = renderUpstream(UPSTREAM, { layout: 'sections' });
    const retries = screen.getByRole('spinbutton', { name: t('up.conn.retries') });
    await form.user.clear(retries);
    await form.user.type(retries, '1.5');
    const toggle = screen.getByRole('button', { name: t('up.section.connection') });
    await form.user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(retries).toHaveValue('1.5');
    expect(getToasts().at(-1)?.message).toBe(refused('1.5'));
  });

  it('the inner tab strip does not switch away from a tab whose field holds input', async () => {
    const form = renderUpstream(UPSTREAM, { layout: 'tabs' });
    await form.user.click(screen.getByRole('tab', { name: t('up.section.connection') }));
    const retries = screen.getByRole('spinbutton', { name: t('up.conn.retries') });
    await form.user.clear(retries);
    await form.user.type(retries, '1.5');
    const before = toastsRaised();
    // Radix asks twice per click (on mousedown, then on focus): one refusal, one toast.
    await form.user.click(screen.getByRole('tab', { name: t('up.section.tls') }));
    expect(screen.getByRole('tab', { name: t('up.section.connection') })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('spinbutton', { name: t('up.conn.retries') })).toHaveValue('1.5');
    expect(toastsRaised()).toBe(before + 1);
    expect(getToasts().at(-1)?.message).toBe(refused('1.5'));
  });

  it('tag text refused only as the box is left (by the click on another inner tab) still stops the switch', async () => {
    const form = renderUpstream({ ...UPSTREAM, checks: { active: { http_path: '/healthz' } } }, { layout: 'tabs' });
    await form.user.click(screen.getByRole('tab', { name: t('up.section.health') }));
    const statuses = screen.getAllByRole('textbox', { name: t('up.hc.statuses') })[0];
    if (!statuses) throw new Error('no statuses box');
    await form.user.type(statuses, '99');
    await form.user.click(screen.getByRole('tab', { name: t('up.section.tls') }));
    expect(screen.getByRole('tab', { name: t('up.section.health') })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('textbox', { name: t('up.hc.statuses') })[0]).toHaveValue('99');
    expect(getToasts().at(-1)?.message).toBe(
      t('ui.pending.refused', { message: t('ui.pending.tag', { field: t('up.hc.statuses'), text: '99', reason: t('up.hc.statusInvalid') }) }),
    );
  });
});

describe('held input stays with its own row', () => {
  const weight = (n: number) => screen.getByRole('spinbutton', { name: t('up.nodes.weightN', { n }) });
  const host = (n: number) => screen.getByRole('textbox', { name: t('up.nodes.hostN', { n }) });
  const notNumber = (n: number) => t('ui.pending.notNumber', { field: t('up.nodes.weightN', { n }), text: '-' });
  const ARRAY = { type: 'roundrobin', nodes: [{ host: 'a', port: 80, weight: 1 }, { host: 'b', port: 80, weight: 2 }, { host: 'c', port: 80, weight: 3 }] };
  const MAP = { type: 'roundrobin', nodes: { 'a:80': 1, 'b:80': 2, 'c:80': 3 } };

  async function holdB(initial: typeof ARRAY | typeof MAP) {
    const form = renderUpstream(initial, { section: 'nodes' });
    await form.user.clear(weight(2));
    await form.user.type(weight(2), '-');
    expect(form.held()).toEqual([notNumber(2)]);
    return form;
  }

  it.each([
    ['an array', ARRAY],
    ['a map', MAP],
  ])('%s: removing a row above keeps "-" on b and c its own weight; the message names b by its new number', async (_, initial) => {
    const form = await holdB(initial);
    await form.user.click(screen.getByRole('button', { name: t('up.nodes.removeN', { n: 1 }) }));
    expect(host(1)).toHaveValue('b');
    expect(weight(1)).toHaveValue('-');
    expect(host(2)).toHaveValue('c');
    expect(weight(2)).toHaveValue('3');
    expect(form.held()).toEqual([notNumber(1)]);
  });

  it('an array: duplicating a row above moves the held row down with it', async () => {
    const form = await holdB(ARRAY);
    await form.user.click(screen.getByRole('button', { name: t('up.nodes.duplicateN', { n: 1 }) }));
    expect(host(3)).toHaveValue('b');
    expect(weight(3)).toHaveValue('-');
    expect(weight(2)).toHaveValue('1');
    expect(weight(4)).toHaveValue('3');
    expect(form.held()).toEqual([notNumber(3)]);
  });

  it.each([
    ['an array', ARRAY, [{ host: 'a', port: 80, weight: 1 }, { host: 'c', port: 80, weight: 3 }]],
    ['a map', MAP, { 'a:80': 1, 'c:80': 3 }],
  ])('%s: removing the held row itself discards what it held; the rest keep their weights', async (_, initial, nodes) => {
    const form = await holdB(initial);
    await form.user.click(screen.getByRole('button', { name: t('up.nodes.removeN', { n: 2 }) }));
    expect(form.held()).toEqual([]);
    expect(weight(2)).toHaveValue('3');
    expect(form.value().nodes).toEqual(nodes);
  });

  it('CA certificate rows follow their row: removing the first keeps the second one the same field', async () => {
    const form = renderUpstream({ type: 'roundrobin', nodes: [], tls: { ca_certs: ['CA-ONE', 'CA-TWO'] } }, { section: 'tls' });
    const second = screen.getByRole('textbox', { name: t('up.tls.caN', { n: 2 }) });
    await form.user.click(screen.getByRole('button', { name: t('up.tls.removeCa', { n: 1 }) }));
    expect(screen.getByRole('textbox', { name: t('up.tls.caN', { n: 1 }) })).toBe(second);
    expect(second).toHaveValue('CA-TWO');
  });
});

