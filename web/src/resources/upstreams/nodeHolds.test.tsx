// Fix round 3: the node table's one rule, pinned on the upstream page with the frame's Save.
// 1. Leaving a field writes nothing. 2. Typing writes what the list can hold at once. 3. Text a map can't
// hold is held exactly as typed, flagged, and named by a refused Save. 4. Enter is the explicit commit;
// 5. "Move <port> to Port" does what Enter does. A commit whose result another row has writes nothing and
// holds the text as a duplicate. A paste (final wave F7): one address goes in at the cursor and is judged as
// typed text; several become one node each, as "Add a node" with Enter would make them.
import { waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { useCallback, useLayoutEffect } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { resetApp } from '../../test/app';
import { main, openEditor, overrideDef, writesOf } from '../../test/editor';
import { getToasts } from '../../ui/toast';
import { registry, type TabDef, type TabProps } from '../registry';

/** Every draft the upstream's tabs set (one entry per draft change), and the draft they last showed. */
const seen: { changes: Obj[]; draft: Obj | undefined } = { changes: [], draft: undefined };

/** A tab as the registry has it, its draft changes counted. */
function Counted({ tab, props }: { tab: TabDef; props: TabProps }) {
  const { setDraft, draft } = props;
  const counted = useCallback(
    (next: Obj) => {
      seen.changes.push(next);
      setDraft(next);
    },
    [setDraft],
  );
  useLayoutEffect(() => {
    seen.draft = draft;
  });
  return tab.render({ ...props, setDraft: counted });
}

let undo: (() => void) | undefined;
beforeAll(async () => {
  await import('../../upstream/SectionTab');
});
beforeEach(() => {
  seen.changes = [];
  seen.draft = undefined;
  const tabs = registry.upstreams.tabs.map((tab): TabDef => ({ ...tab, render: (props) => <Counted tab={tab} props={props} /> }));
  undo = overrideDef('upstreams', { tabs });
});
afterEach(() => {
  undo?.();
  resetApp();
  resetReadOnlyKeys();
});

const newHost = () => main().getByRole('textbox', { name: t('up.nodes.new') });
const hostN = (n: number) => main().getByRole('textbox', { name: t('up.nodes.hostN', { n }) });
const priorityN = (n: number) => main().getByRole('spinbutton', { name: t('up.nodes.priorityN', { n }) });
const save = () => main().getByRole('button', { name: t('editor.save') });
const newNode = () => t('up.pending.newNode');
const node = (n: number) => t('up.pending.node', { n });
const nodesNow = (): unknown => structuredClone(seen.draft?.nodes);

/** The upstream page in Edit, on the Nodes tab, its nodes `nodes`. */
async function edit(nodes: unknown) {
  const app = await openEditor('#/upstreams/m1?tab=nodes', { objects: { upstreams: [{ id: 'm1', name: 'map-pool', type: 'roundrobin', nodes }] } });
  await main().findByRole('heading', { level: 1, name: 'map-pool' });
  await app.user.keyboard('e');
  await main().findByRole('textbox', { name: t('up.nodes.new') });
  return app;
}

const typeInto = async (user: UserEvent, field: HTMLElement, text: string, clear = false) => {
  if (clear) await user.clear(field);
  await user.type(field, text);
};

interface HeldCase {
  nodes: unknown;
  /** From a fresh Edit to the held state. */
  reach: (user: UserEvent) => Promise<void>;
  /** The held field. */
  field: () => HTMLElement;
  /** What it shows: exactly what was typed (or pasted). */
  typed: string;
  /** Its flag's message. */
  message: string;
  /** What a refused Save names. */
  pending: string;
}

const HELD: [string, HeldCase][] = [
  [
    'an all-digit host typed into "Add a node"',
    { nodes: { 'a.example': 1 }, reach: (u) => typeInto(u, newHost(), '42'), field: newHost, typed: '42', message: t('up.nodes.digitsHeld'), pending: t('up.pending.unsaved', { node: newNode(), addr: '42' }) },
  ],
  [
    'an all-digit host typed into a row',
    { nodes: { 'a.example': 1, 'b.example': 1 }, reach: (u) => typeInto(u, hostN(2), '42', true), field: () => hostN(2), typed: '42', message: t('up.nodes.digitsHeld'), pending: t('up.pending.unsaved', { node: node(2), addr: '42' }) },
  ],
  [
    'a stray colon typed into "Add a node"',
    { nodes: { 'a.example': 1 }, reach: (u) => typeInto(u, newHost(), '10:'), field: newHost, typed: '10:', message: t('up.nodes.colonHeld'), pending: t('up.pending.unsaved', { node: newNode(), addr: '10:' }) },
  ],
  [
    'a stray colon typed into a row',
    {
      nodes: { 'a.example:80': 1, 'b.example:80': 1 },
      reach: (u) => typeInto(u, hostN(1), '10.0.0.9:', true),
      field: () => hostN(1),
      typed: '10.0.0.9:',
      message: t('up.nodes.colonHeld'),
      pending: t('up.pending.unsaved', { node: node(1), addr: '10.0.0.9:' }),
    },
  ],
  [
    'an address the list has, typed into "Add a node"',
    {
      nodes: { 'a.example': 1, 'b.example': 1 },
      reach: (u) => typeInto(u, newHost(), 'a.example'),
      field: newHost,
      typed: 'a.example',
      message: t('up.nodes.dupOf', { n: 1 }),
      pending: t('up.pending.duplicate', { node: newNode(), addr: 'a.example' }),
    },
  ],
  [
    'an address the list has, typed into a row',
    { nodes: { 'a:80': 1, 'b:80': 1 }, reach: (u) => typeInto(u, hostN(2), 'a', true), field: () => hostN(2), typed: 'a', message: t('up.nodes.dupOf', { n: 1 }), pending: t('up.pending.duplicate', { node: node(2), addr: 'a:80' }) },
  ],
  [
    'an address the list has, by Enter in "Add a node" (re-review 2)',
    {
      nodes: { '10.0.0.5:8080': 1, '10.0.0.6:80': 1 },
      reach: async (u) => {
        await typeInto(u, newHost(), '10.0.0.5:8080');
        await u.keyboard('{Enter}');
      },
      field: newHost,
      typed: '10.0.0.5:8080',
      message: t('up.nodes.dupOf', { n: 1 }),
      pending: t('up.pending.duplicate', { node: newNode(), addr: '10.0.0.5:8080' }),
    },
  ],
  [
    'an address the list has, by Enter in a row',
    {
      nodes: { '10.0.0.5:8080': 1, '10.0.0.6:80': 1 },
      reach: async (u) => {
        await typeInto(u, hostN(2), '10.0.0.5:8080', true);
        await u.keyboard('{Enter}');
      },
      field: () => hostN(2),
      typed: '10.0.0.5:8080',
      message: t('up.nodes.dupOf', { n: 1 }),
      pending: t('up.pending.duplicate', { node: node(2), addr: '10.0.0.5:8080' }),
    },
  ],
  [
    // Re-review 2, out of scope: digits:port never becomes a row, and Enter judged it as the unsplit text.
    'an address the list has, by Enter in "Add a node" holding digits:port',
    {
      nodes: { '10:9090': 1 },
      reach: async (u) => {
        await typeInto(u, newHost(), '10:9090');
        await u.keyboard('{Enter}');
      },
      field: newHost,
      typed: '10:9090',
      message: t('up.nodes.dupOf', { n: 1 }),
      pending: t('up.pending.duplicate', { node: newNode(), addr: '10:9090' }),
    },
  ],
  [
    'an address the list has, by "Move <port> to Port" in "Add a node"',
    {
      nodes: { '10:9090': 1 },
      reach: async (u) => {
        await typeInto(u, newHost(), '10:9090');
        await u.click(main().getByRole('button', { name: t('up.nodes.movePortNew', { port: 9090 }) }));
      },
      field: newHost,
      typed: '10:9090',
      message: t('up.nodes.dupOf', { n: 1 }),
      pending: t('up.pending.duplicate', { node: newNode(), addr: '10:9090' }),
    },
  ],
  [
    'an address the list has, by "Move <port> to Port" in a row',
    {
      nodes: { '10.0.0.5:8080': 1, '10.0.0.6:80': 1 },
      reach: async (u) => {
        await typeInto(u, hostN(2), '10.0.0.5:8080', true);
        await u.click(main().getByRole('button', { name: t('up.nodes.movePortN', { port: 8080, n: 2 }) }));
      },
      field: () => hostN(2),
      typed: '10.0.0.5:8080',
      message: t('up.nodes.dupOf', { n: 1 }),
      pending: t('up.pending.duplicate', { node: node(2), addr: '10.0.0.5:8080' }),
    },
  ],
  // Final wave F7 (these expectations changed): one pasted address goes in as typed, then is judged as typed text.
  [
    'host:port pasted into "Add a node" (judged as typed: a stray colon)',
    {
      nodes: { '10.0.0.5:8080': 1 },
      reach: async (u) => {
        await u.click(newHost());
        await u.paste('10.0.0.5:8080');
      },
      field: newHost,
      typed: '10.0.0.5:8080',
      message: t('up.nodes.colonHeld'),
      pending: t('up.pending.unsaved', { node: newNode(), addr: '10.0.0.5:8080' }),
    },
  ],
  [
    'host:port pasted over a row\'s host (judged as typed: a stray colon)',
    {
      nodes: { '10.0.0.5:8080': 1, '10.0.0.6:80': 1 },
      reach: async (u) => {
        await u.tripleClick(hostN(2));
        await u.paste('10.0.0.5:8080');
      },
      field: () => hostN(2),
      typed: '10.0.0.5:8080',
      message: t('up.nodes.colonHeld'),
      pending: t('up.pending.unsaved', { node: node(2), addr: '10.0.0.5:8080' }),
    },
  ],
  [
    'a port pasted at the end of a stored host (re-review 3, O3: inserted at the cursor, not over the host)',
    {
      nodes: { '10.0.0.5:80': 1 },
      reach: async (u) => {
        await u.click(hostN(1));
        await u.keyboard('{End}');
        await u.paste(':9090');
      },
      field: () => hostN(1),
      typed: '10.0.0.5:9090',
      message: t('up.nodes.colonHeld'),
      pending: t('up.pending.unsaved', { node: node(1), addr: '10.0.0.5:9090' }),
    },
  ],
  [
    'a row whose clash another row resolved (not in the list yet)',
    {
      nodes: { 'a:80': 1, 'b:80': 1, 'c:80': 1 },
      reach: async (u) => {
        await typeInto(u, hostN(3), 'a', true);
        await typeInto(u, hostN(1), 'z', true);
      },
      field: () => hostN(3),
      typed: 'a',
      message: t('up.nodes.heldNotYet'),
      pending: t('up.pending.unsaved', { node: node(3), addr: 'a:80' }),
    },
  ],
  [
    '"Add a node" whose clash another row resolved (not in the list yet)',
    {
      nodes: { a: 1, b: 1 },
      reach: async (u) => {
        await typeInto(u, newHost(), 'a');
        await typeInto(u, hostN(1), 'z', true);
      },
      field: newHost,
      typed: 'a',
      message: t('up.nodes.heldNotYet'),
      pending: t('up.pending.unsaved', { node: newNode(), addr: 'a' }),
    },
  ],
  // Final wave F2/F6: a change that turns the map into an array (a priority, "Keep both") ends no other row's hold.
  [
    'a duplicate held in a row, then a priority set on another row (the list becomes an array)',
    {
      nodes: { 'a:80': 1, 'b:80': 1 },
      reach: async (u) => {
        await typeInto(u, hostN(2), 'a', true);
        await typeInto(u, priorityN(1), '1');
      },
      field: () => hostN(2),
      typed: 'a',
      message: t('up.nodes.heldNotYet'),
      pending: t('up.pending.unsaved', { node: node(2), addr: 'a:80' }),
    },
  ],
  [
    'a duplicate held in a row, then a priority set on that row',
    {
      nodes: { 'a:80': 1, 'b:80': 1 },
      reach: async (u) => {
        await typeInto(u, hostN(2), 'a', true);
        await typeInto(u, priorityN(2), '1');
      },
      field: () => hostN(2),
      typed: 'a',
      message: t('up.nodes.heldNotYet'),
      pending: t('up.pending.unsaved', { node: node(2), addr: 'a:80' }),
    },
  ],
  [
    '"Add a node" holding digits, then "Keep both" on a row',
    {
      nodes: { 'a:80': 1, 'b:80': 1 },
      reach: async (u) => {
        await typeInto(u, newHost(), '42');
        await typeInto(u, hostN(2), 'a', true);
        await u.click(main().getByRole('button', { name: t('up.nodes.keepBothN', { n: 2 }) }));
      },
      field: newHost,
      typed: '42',
      message: t('up.nodes.heldNotYet'),
      pending: t('up.pending.unsaved', { node: newNode(), addr: '42' }),
    },
  ],
  [
    'a stray colon held in a row, then "Keep both" on another row',
    {
      nodes: { 'a:80': 1, 'b:80': 1, 'c:80': 1 },
      reach: async (u) => {
        await typeInto(u, hostN(3), '10:', true);
        await typeInto(u, hostN(2), 'a', true);
        await u.click(main().getByRole('button', { name: t('up.nodes.keepBothN', { n: 2 }) }));
      },
      field: () => hostN(3),
      typed: '10:',
      message: t('up.nodes.heldNotYet'),
      pending: t('up.pending.unsaved', { node: node(3), addr: '10:' }),
    },
  ],
];

const saveKeys = (u: UserEvent) => u.keyboard('{Control>}s{/Control}');
/** Each way out that must change nothing; `saves` when it is the save gesture itself. */
const WAYS_OUT: [string, { go: (u: UserEvent) => Promise<void>; saves: boolean }][] = [
  ['Tab away', { go: (u) => u.tab(), saves: false }],
  ['a click elsewhere', { go: (u) => u.click(main().getByRole('heading', { level: 1 })), saves: false }],
  ['Cmd/Ctrl-S at once, focus in the field', { go: saveKeys, saves: true }],
  [
    'Cmd/Ctrl-S after leaving',
    {
      go: async (u) => {
        await u.tab();
        await saveKeys(u);
      },
      saves: true,
    },
  ],
];

describe('the node table: a held field changes nothing on any way out', () => {
  describe.each(HELD)('%s', (_, c) => {
    it.each(WAYS_OUT)('%s: the draft as it was, no request, the toast names the node, the field as typed and flagged', async (_way, way) => {
      const { user, admin } = await edit(c.nodes);
      await c.reach(user);
      await user.click(c.field());
      expect(c.field()).toHaveValue(c.typed);
      expect(c.field()).toHaveAttribute('aria-invalid', 'true');
      expect(c.field()).toHaveAccessibleDescription(c.message);
      const nodes = nodesNow();
      const changes = seen.changes.length;

      await way.go(user);
      // Not a save gesture: the frame's Save, after it.
      if (!way.saves) await user.click(save());
      await waitFor(() => expect(getToasts().at(-1)?.message).toContain(c.pending));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(writesOf(admin)).toEqual([]);
      expect(seen.changes).toHaveLength(changes);
      expect(nodesNow()).toEqual(nodes);
      expect(c.field()).toHaveValue(c.typed);
      expect(c.field()).toHaveAttribute('aria-invalid', 'true');
      expect(c.field()).toHaveAccessibleDescription(c.message);
    });
  });
});

interface CommitCase {
  nodes: unknown;
  /** From a fresh Edit to just before the commit. */
  reach: (user: UserEvent) => Promise<void>;
  commit: (user: UserEvent) => Promise<void>;
  /** The nodes after it, and what Save then sends. */
  expected: unknown;
}

const enter = (u: UserEvent) => u.keyboard('{Enter}');
const moveButton = (name: string) => (u: UserEvent) => u.click(main().getByRole('button', { name }));

const COMMITS: [string, CommitCase][] = [
  [
    'Enter in a map row whose host holds a port',
    { nodes: { '10.0.0.5:8080': 1, '10.0.0.6:80': 1 }, reach: (u) => typeInto(u, hostN(2), '10.0.0.7:9090', true), commit: enter, expected: { '10.0.0.5:8080': 1, '10.0.0.7:9090': 1 } },
  ],
  [
    'Enter in a stored array row whose host holds a port',
    {
      nodes: [{ host: '10.0.0.7:9090', port: 80, weight: 1 }],
      reach: (u) => u.click(hostN(1)),
      commit: enter,
      expected: [{ host: '10.0.0.7', port: 9090, weight: 1 }],
    },
  ],
  [
    'Enter after host:port typed into "Add a node" (an array)',
    {
      nodes: [{ host: '10.0.0.6', port: 80, weight: 1 }],
      reach: (u) => typeInto(u, newHost(), '10.0.0.5:8080'),
      commit: enter,
      expected: [
        { host: '10.0.0.6', port: 80, weight: 1 },
        { host: '10.0.0.5', port: 8080, weight: 1 },
      ],
    },
  ],
  [
    'Enter after host:port typed into "Add a node" (a map)',
    { nodes: { '10.0.0.6:80': 1 }, reach: (u) => typeInto(u, newHost(), '10.0.0.5:8080'), commit: enter, expected: { '10.0.0.6:80': 1, '10.0.0.5:8080': 1 } },
  ],
  [
    'Enter in "Add a node" holding digits:port (a map)',
    { nodes: { 'a.example': 1 }, reach: (u) => typeInto(u, newHost(), '10:9090'), commit: enter, expected: { 'a.example': 1, '10:9090': 1 } },
  ],
  ['Enter in a held all-digit host, a row', { nodes: { 'a.example': 1, 'b.example': 1 }, reach: (u) => typeInto(u, hostN(2), '42', true), commit: enter, expected: { 'a.example': 1, 42: 1 } }],
  ['Enter in a held all-digit host, "Add a node"', { nodes: { 'a.example': 1 }, reach: (u) => typeInto(u, newHost(), '42'), commit: enter, expected: { 'a.example': 1, 42: 1 } }],
  [
    'Enter in a row whose clash another row resolved',
    {
      nodes: { 'a:80': 1, 'b:80': 1, 'c:80': 1 },
      reach: async (u) => {
        await typeInto(u, hostN(3), 'a', true);
        await typeInto(u, hostN(1), 'z', true);
        await u.click(hostN(3));
      },
      commit: enter,
      expected: { 'z:80': 1, 'b:80': 1, 'a:80': 1 },
    },
  ],
  [
    'Enter in "Add a node" whose clash another row resolved',
    {
      nodes: { a: 1, b: 1 },
      reach: async (u) => {
        await typeInto(u, newHost(), 'a');
        await typeInto(u, hostN(1), 'z', true);
        await u.click(newHost());
      },
      commit: enter,
      expected: { z: 1, b: 1, a: 1 },
    },
  ],
  [
    '"Move <port> to Port" in a map row',
    {
      nodes: { '10.0.0.5:8080': 1, '10.0.0.6:80': 1 },
      reach: (u) => typeInto(u, hostN(2), '10.0.0.7:9090', true),
      commit: moveButton(t('up.nodes.movePortN', { port: 9090, n: 2 })),
      expected: { '10.0.0.5:8080': 1, '10.0.0.7:9090': 1 },
    },
  ],
  [
    '"Move <port> to Port" in "Add a node"',
    { nodes: { 'a.example': 1 }, reach: (u) => typeInto(u, newHost(), '10:9090'), commit: moveButton(t('up.nodes.movePortNew', { port: 9090 })), expected: { 'a.example': 1, '10:9090': 1 } },
  ],
  [
    '"Move <port> to Port" in an array row',
    {
      nodes: [{ host: '10.0.0.7:9090', port: 80, weight: 1 }],
      reach: async () => {},
      commit: moveButton(t('up.nodes.movePortN', { port: 9090, n: 1 })),
      expected: [{ host: '10.0.0.7', port: 9090, weight: 1 }],
    },
  ],
  [
    'Enter after host:port pasted over a map row\'s host',
    {
      nodes: { '10.0.0.5:8080': 1, '10.0.0.6:80': 1 },
      reach: async (u) => {
        await u.tripleClick(hostN(2));
        await u.paste('10.0.0.7:9090');
      },
      commit: enter,
      expected: { '10.0.0.5:8080': 1, '10.0.0.7:9090': 1 },
    },
  ],
  [
    'a paste of two addresses into "Add a node" (a map)',
    { nodes: { '10.0.0.5:8080': 1 }, reach: (u) => u.click(newHost()), commit: (u) => u.paste('10.0.0.7:9090\n10.0.0.8:80'), expected: { '10.0.0.5:8080': 1, '10.0.0.7:9090': 1, '10.0.0.8:80': 1 } },
  ],
  [
    // Final wave F7: each address judged as "Add a node" judges it; the clash and the stray colon in the middle are not written.
    'a paste of four addresses, a clash and a stray colon in the middle (a map)',
    {
      nodes: { '10.0.0.5:8080': 1 },
      reach: (u) => u.click(newHost()),
      commit: (u) => u.paste('10.0.0.7:9090\n10.0.0.5:8080\n10.0.0.9:\n10.0.0.8:80'),
      expected: { '10.0.0.5:8080': 1, '10.0.0.7:9090': 1, '10.0.0.8:80': 1 },
    },
  ],
  [
    'Enter in a row still held after a priority made the list an array (F2)',
    {
      nodes: { 'a:80': 1, 'b:80': 1 },
      reach: async (u) => {
        await typeInto(u, hostN(2), 'a', true);
        await typeInto(u, priorityN(1), '1');
        await u.click(hostN(2));
      },
      commit: enter,
      expected: [
        { host: 'a', port: 80, weight: 1, priority: 1 },
        { host: 'a', port: 80, weight: 1 },
      ],
    },
  ],
  [
    'Enter in "Add a node" still held after "Keep both" made the list an array (F6)',
    {
      nodes: { 'a:80': 1, 'b:80': 1 },
      reach: async (u) => {
        await typeInto(u, newHost(), '42');
        await typeInto(u, hostN(2), 'a', true);
        await u.click(main().getByRole('button', { name: t('up.nodes.keepBothN', { n: 2 }) }));
        await u.click(newHost());
      },
      commit: enter,
      expected: [
        { host: 'a', port: 80, weight: 1 },
        { host: 'a', port: 80, weight: 1 },
        { host: '42', weight: 1 },
      ],
    },
  ],
  [
    'a paste of two addresses into an array row (the row as it was, the nodes added at the end)',
    {
      nodes: [{ host: 'a', port: 80, weight: 1 }],
      reach: (u) => u.click(hostN(1)),
      commit: (u) => u.paste('10.0.0.7:9090 10.0.0.8'),
      expected: [{ host: 'a', port: 80, weight: 1 }, { host: '10.0.0.7', port: 9090, weight: 1 }, { host: '10.0.0.8', weight: 1 }],
    },
  ],
];

describe('the node table: each commit is exactly one draft change', () => {
  it.each(COMMITS)('%s', async (_, c) => {
    const { user, admin } = await edit(c.nodes);
    await c.reach(user);
    const changes = seen.changes.length;
    await c.commit(user);
    expect(seen.changes).toHaveLength(changes + 1);
    expect(seen.changes.at(-1)?.nodes).toEqual(c.expected);
    expect(nodesNow()).toEqual(c.expected);
    // Nothing is left held: Save sends exactly that.
    await user.click(save());
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.nodes).toEqual(c.expected);
  });
});
