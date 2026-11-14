import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import {
  addMapNode,
  addNodes,
  addrOf,
  canDuplicate,
  duplicateNode,
  keepBoth,
  setMapAddress,
  type AddressEdit,
  isNodeList,
  parseAddr,
  parseNodeList,
  pasteNodes,
  removeNode,
  rowsOf,
  setNodeField,
  sharesOf,
  usesDiscovery,
} from './nodes';

describe('parseAddr / addrOf (as core.utils.parse_addr reads a map key)', () => {
  it.each([
    ['10.0.0.1:80', { host: '10.0.0.1', port: 80 }],
    ['backend.internal', { host: 'backend.internal' }],
    ['backend.internal:8443', { host: 'backend.internal', port: 8443 }],
    ['[::1]:8080', { host: '[::1]', port: 8080 }],
    ['[::1]', { host: '[::1]' }],
    ['::1', { host: '::1' }],
    ['2001:db8::68', { host: '2001:db8::68' }],
    ['host:http', { host: 'host:http' }],
  ])('%s', (addr, row) => {
    expect(parseAddr(addr)).toEqual(row);
  });

  it('writes a port after a bare IPv6 address in brackets', () => {
    expect(addrOf('::1', 80)).toBe('[::1]:80');
    expect(addrOf('[::1]', 80)).toBe('[::1]:80');
    expect(addrOf('a.example', undefined)).toBe('a.example');
  });
});

describe('rowsOf', () => {
  it('reads both shapes', () => {
    expect(rowsOf([{ host: 'a', port: 1, weight: 2, priority: 3, metadata: { x: 1 } }, 'junk'])).toEqual([
      { host: 'a', port: 1, weight: 2, priority: 3 },
      {},
    ]);
    expect(rowsOf({ 'a:1': 2, b: 0 })).toEqual([
      { host: 'a', port: 1, weight: 2, addr: 'a:1' },
      { host: 'b', weight: 0, addr: 'b' },
    ]);
    expect(rowsOf(undefined)).toEqual([]);
  });
});

describe('editing nodes', () => {
  const MAP = { type: 'roundrobin', nodes: { '10.0.0.1:80': 3, 'b.example': 1 } };
  const ARRAY = { nodes: [{ host: '10.0.0.1', port: 80, weight: 3, metadata: { zone: 'a' } }] };
  const ok = (edit: AddressEdit) => {
    if (!edit.ok) throw new Error(`expected the edit to go through, got ${edit.reason}`);
    return edit.up.nodes;
  };

  it('a map keeps its shape and order through address, weight and port edits', () => {
    expect(ok(setMapAddress(MAP, 1, { host: 'b.example', port: 8080 }))).toEqual({ '10.0.0.1:80': 3, 'b.example:8080': 1 });
    expect(Object.keys(ok(setMapAddress(MAP, 0, { host: 'a', port: 1 })) as Obj)).toEqual(['a:1', 'b.example']);
    expect(setNodeField(MAP, 0, 'weight', 5).nodes).toEqual({ '10.0.0.1:80': 5, 'b.example': 1 });
    // An emptied host or weight stays in its row, for upstreamIssues to flag.
    expect(ok(setMapAddress(MAP, 0, { host: '', port: 80 }))).toEqual({ ':80': 3, 'b.example': 1 });
    expect(setNodeField(MAP, 1, 'weight', undefined).nodes).toEqual({ '10.0.0.1:80': 3, 'b.example': null });
    // A priority of 0 is what the map means anyway.
    expect(setNodeField(MAP, 0, 'priority', 0)).toBe(MAP);
  });

  it('a map turns into the array shape only for a priority other than 0, weights kept', () => {
    expect(setNodeField(MAP, 0, 'priority', 1).nodes).toEqual([
      { host: '10.0.0.1', port: 80, weight: 3, priority: 1 },
      { host: 'b.example', weight: 1 },
    ]);
  });

  it('refuses an address another map entry has, naming that entry, and an all-digit host without a port until told to commit', () => {
    expect(setMapAddress(MAP, 1, { host: '10.0.0.1', port: 80 })).toEqual({ ok: false, reason: 'duplicate', other: 0 });
    expect(setMapAddress(MAP, 1, { host: '10', port: undefined })).toEqual({ ok: false, reason: 'digits' });
    expect(ok(setMapAddress(MAP, 1, { host: '10', port: undefined }, { commitDigits: true }))).toEqual({ '10.0.0.1:80': 3, 10: 1 });
    expect(ok(setMapAddress(MAP, 1, { host: '10', port: 80 }))).toEqual({ '10.0.0.1:80': 3, '10:80': 1 });
    expect(addMapNode(MAP, { host: 'b.example', port: undefined })).toEqual({ ok: false, reason: 'duplicate', other: 1 });
    expect(ok(addMapNode(MAP, { host: 'c', port: 1 }))).toEqual({ '10.0.0.1:80': 3, 'b.example': 1, 'c:1': 1 });
  });

  it('keeps both entries at one address as the array shape when told to', () => {
    expect(keepBoth(MAP, 1, { host: '10.0.0.1', port: 80 }).nodes).toEqual([
      { host: '10.0.0.1', port: 80, weight: 3 },
      { host: '10.0.0.1', port: 80, weight: 1 },
    ]);
    expect(keepBoth(MAP, 2, { host: 'b.example', port: undefined }).nodes).toEqual([
      { host: '10.0.0.1', port: 80, weight: 3 },
      { host: 'b.example', weight: 1 },
      { host: 'b.example', weight: 1 },
    ]);
  });

  it('duplicates a map entry as a row with an empty host, once', () => {
    const copied = duplicateNode(MAP, 0);
    expect(copied.nodes).toEqual({ '10.0.0.1:80': 3, ':80': 3, 'b.example': 1 });
    expect(canDuplicate(copied, 0)).toBe(false);
    expect(duplicateNode(copied, 0)).toBe(copied);
    expect(canDuplicate(MAP, 1)).toBe(true);
  });

  it('edits an array row in place, keeping keys the form does not show', () => {
    expect(setNodeField(ARRAY, 0, 'weight', 7).nodes).toEqual([{ host: '10.0.0.1', port: 80, weight: 7, metadata: { zone: 'a' } }]);
    expect(setNodeField(ARRAY, 0, 'port', undefined).nodes).toEqual([{ host: '10.0.0.1', weight: 3, metadata: { zone: 'a' } }]);
    expect(setNodeField(ARRAY, 0, 'host', '').nodes).toEqual([{ port: 80, weight: 3, metadata: { zone: 'a' } }]);
    expect(duplicateNode(ARRAY, 0).nodes).toEqual([ARRAY.nodes[0], ARRAY.nodes[0]]);
  });

  it('adds nodes: to the array shape (also with no nodes yet), and to a map leaving out addresses it has', () => {
    expect(addNodes({}, [{ host: 'a', weight: 1 }])).toEqual({ up: { nodes: [{ host: 'a', weight: 1 }] }, skipped: [] });
    expect(addNodes(ARRAY, [{ host: 'a', weight: 1 }]).up.nodes).toEqual([...ARRAY.nodes, { host: 'a', weight: 1 }]);
    expect(addNodes(MAP, [{ host: 'b.example' }, { host: 'c', port: 1 }, { host: 'c', port: 1 }])).toEqual({
      up: { ...MAP, nodes: { '10.0.0.1:80': 3, 'b.example': 1, 'c:1': 1 } },
      skipped: ['b.example', 'c:1'],
    });
  });

  it('keeps an emptied list as an empty list of its shape', () => {
    expect(removeNode(ARRAY, 0).nodes).toEqual([]);
    expect(removeNode({ nodes: { a: 1 } }, 0).nodes).toEqual({});
    expect(removeNode(MAP, 0).nodes).toEqual({ 'b.example': 1 });
  });

  it('a paste replaces the address of the row it lands in and adds the rest after it', () => {
    const up = { nodes: [{ host: 'old', port: 1, weight: 4 }, { host: 'z', weight: 1 }] };
    expect(pasteNodes(up, 0, [{ host: 'a', port: 80 }, { host: 'b', port: 81 }])).toEqual({
      up: { nodes: [{ host: 'a', port: 80, weight: 4 }, { host: 'b', port: 81, weight: 1 }, { host: 'z', weight: 1 }] },
      skipped: [],
    });
    // A host without a port keeps the row's port.
    expect(pasteNodes(up, 0, [{ host: 'a' }]).up.nodes).toEqual([{ host: 'a', port: 1, weight: 4 }, { host: 'z', weight: 1 }]);
    // In a map, addresses already there are left out and named.
    expect(pasteNodes(MAP, 1, [{ host: '10.0.0.1', port: 80 }, { host: 'c' }])).toEqual({
      up: { ...MAP, nodes: { '10.0.0.1:80': 3, 'b.example': 1, c: 1 } },
      skipped: ['10.0.0.1:80'],
    });
  });
});

describe('pasted text', () => {
  it('splits on lines, commas and spaces', () => {
    expect(parseNodeList('10.0.0.1:80\n10.0.0.2:8080, b.example\r\n')).toEqual([
      { host: '10.0.0.1', port: 80 },
      { host: '10.0.0.2', port: 8080 },
      { host: 'b.example' },
    ]);
  });

  it('is read as addresses when it holds several or a port', () => {
    expect(isNodeList('a.example')).toBe(false);
    expect(isNodeList('a.example:80')).toBe(true);
    expect(isNodeList('a\nb')).toBe(true);
  });
});

describe('sharesOf', () => {
  it('splits the top priority by weight; lower priorities stand by', () => {
    expect(sharesOf([{ weight: 2 }, { weight: 1, priority: 0 }, { weight: 5, priority: -1 }], 'roundrobin')).toEqual([2 / 3, 1 / 3, 'standby']);
    expect(sharesOf([{ weight: 0 }, { weight: 0 }], undefined)).toEqual([0, 0]);
  });

  it('is undefined for algorithms that do not split by weight', () => {
    expect(sharesOf([{ weight: 1 }], 'least_conn')).toBeUndefined();
    expect(sharesOf([{ weight: 1 }], 'ewma')).toBeUndefined();
  });
});

describe('usesDiscovery', () => {
  it('is true without nodes and with any discovery field', () => {
    expect(usesDiscovery({ service_name: 'a' })).toBe(true);
    expect(usesDiscovery({ nodes: [], service_name: 'a' })).toBe(false);
    expect(usesDiscovery({})).toBe(false);
  });
});
