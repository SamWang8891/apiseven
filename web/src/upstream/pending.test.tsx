// The upstream form never hides a field that holds input it has not emitted (usePending): a
// section does not collapse, and the inner tab strip does not switch, until it is fixed or cleared.
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { renderUpstream } from '../test/upstream';
import { getToasts } from '../ui/toast';

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
    const before = getToasts().length;
    // Radix asks twice per click (on mousedown, then on focus): one refusal, one toast.
    await form.user.click(screen.getByRole('tab', { name: t('up.section.tls') }));
    expect(screen.getByRole('tab', { name: t('up.section.connection') })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('spinbutton', { name: t('up.conn.retries') })).toHaveValue('1.5');
    expect(getToasts().slice(before).map((toast) => toast.message)).toEqual([refused('1.5')]);
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

