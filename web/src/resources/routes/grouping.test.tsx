import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import { buildPage } from '../../table/rows';
import { ctxOf, itemOf } from '../../test/ctx';
import { hostGrouping } from './grouping';

const DAY = 86_400_000;

const CTX = ctxOf({
  services: [itemOf('s1', { hosts: ['www.example'] })],
  ssls: [
    itemOf('soon', { snis: ['*.example'], validity_end: Math.floor((Date.now() + 10 * DAY) / 1000) }),
    itemOf('gone', { snis: ['old.example'], validity_end: Math.floor((Date.now() - 2 * DAY) / 1000) }),
  ],
});

describe('hostGrouping', () => {
  it('is the host grouping, labelled from the language table', () => {
    expect(hostGrouping.id).toBe('host');
    expect(hostGrouping.label).toBe(t('group.byHost'));
    expect(hostGrouping.ungroupedLabel).toBe(t('group.anyHost'));
  });

  it('groups a route under each of its hosts, wildcards as written, service hosts included', () => {
    expect(hostGrouping.groupBy(itemOf('r1', { hosts: ['a.example', '*.example'] }), CTX)).toEqual(['a.example', '*.example']);
    expect(hostGrouping.groupBy(itemOf('r2', { host: 'b.example' }), CTX)).toEqual(['b.example']);
    expect(hostGrouping.groupBy(itemOf('r3', { service_id: 's1' }), CTX)).toEqual(['www.example']);
    expect(hostGrouping.groupBy(itemOf('r4', { uri: '/*' }), CTX)).toEqual([]);
  });

  it('puts a route with two hosts in two groups, and one without under the ungrouped group', () => {
    const items = [itemOf('r1', { name: 'both', hosts: ['b.example', 'a.example'] }), itemOf('r2', { name: 'any' })];
    const { rows } = buildPage(items, 0, 50, (item) => hostGrouping.groupBy(item, CTX));
    expect(rows.map((r) => (r.type === 'group' ? `# ${r.group ?? '(none)'}` : r.item.value.name))).toEqual([
      '# a.example', 'both', '# b.example', 'both', '# (none)', 'any',
    ]);
  });

  it('heads a group with the host, the route count and the expiry of its certificate', () => {
    const items = [itemOf('r1'), itemOf('r2')];
    const { container } = render(<>{hostGrouping.header?.('api.example', items, CTX)}</>);
    expect(container.querySelector('.cell-group__host')).toHaveTextContent('api.example');
    expect(container.querySelector('.cell-group__host')).toHaveClass('mono');
    expect(container).toHaveTextContent('2');
    expect(container.querySelector('.ui-badge')).toHaveClass('expiry--warn');
  });

  it('shows an expired certificate as danger, and the empty mark with none', () => {
    const expired = render(<>{hostGrouping.header?.('old.example', [itemOf('r1')], CTX)}</>);
    expect(expired.container.querySelector('.ui-badge')).toHaveClass('expiry--danger');
    expired.unmount();
    const none = render(<>{hostGrouping.header?.('plain.org', [itemOf('r1')], CTX)}</>);
    expect(none.container.querySelector('.ui-badge')).toBeNull();
    expect(none.container).toHaveTextContent(t('ui.empty'));
  });
});
