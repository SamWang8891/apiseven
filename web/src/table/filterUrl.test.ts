// Every quick filter's option survives the URL (f.<id>=…): a reload, a bookmark or Back shows the
// same rows. An option whose value is '' did not (readSelection skips an empty param).
import { describe, expect, it } from 'vitest';
import type { Item, Kind } from '../api/types';
import { registry } from '../resources/registry';
import { ctxOf, itemOf } from '../test/ctx';
import { readSelection, writeSelection } from './filter';

/** Items of each kind with filters, chosen so every option a filter can offer is offered (the "none" ones too). */
const SAMPLES: Partial<Record<Kind, Item[]>> = {
  routes: [
    itemOf('r1', { uri: '/', service_id: 's1', status: 1, plugins: { cors: {} }, labels: { team: 'a' } }),
    itemOf('r2', { uri: '/b', status: 0 }),
  ],
  services: [itemOf('s1', { plugins: { cors: {} }, labels: { team: 'a' } }), itemOf('s2', {})],
  upstreams: [itemOf('u1', { type: 'chash', scheme: 'https', nodes: [] }), itemOf('u2', { nodes: [] })],
  consumers: [
    { id: 'alice', value: { username: 'alice', group_id: 'partners', plugins: { 'key-auth': {} }, labels: { org: 'acme' } } },
    { id: 'bob', value: { username: 'bob' } },
  ],
  ssls: [itemOf('c1', { snis: ['a.test'], status: 0 }), itemOf('c2', { type: 'client' })],
};
const CTX = ctxOf({ services: [itemOf('s1', { name: 'web' })], consumerGroups: [itemOf('partners', { name: 'partners' })], routes: SAMPLES.routes });

const cases = (Object.keys(registry) as Kind[]).flatMap((kind) =>
  (registry[kind].filters ?? []).map((filter) => ({ name: `${kind}.${filter.id}`, kind, filter })),
);

describe('filter options in the URL', () => {
  it('every kind with filters has samples here', () => {
    for (const { kind } of cases) expect(SAMPLES[kind], kind).toBeDefined();
  });

  it.each(cases)('$name: each option, alone and with the others, reads back as written', ({ kind, filter }) => {
    const options = filter.options(SAMPLES[kind] ?? [], CTX);
    expect(options.length, 'the samples give it options').toBeGreaterThan(0);
    for (const option of options) {
      expect(readSelection(writeSelection(new URLSearchParams(), { [filter.id]: [option.value] })), JSON.stringify(option)).toEqual({ [filter.id]: [option.value] });
    }
    const all = options.map((o) => o.value);
    expect(readSelection(writeSelection(new URLSearchParams(), { [filter.id]: all }))).toEqual({ [filter.id]: all });
  });
});
