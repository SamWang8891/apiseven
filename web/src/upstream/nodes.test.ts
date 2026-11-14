import { describe, expect, it } from 'vitest';
import {
  addNodes,
  addrOf,
  duplicateNode,
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

  it('keeps the map shape while every row fits it', () => {
    expect(setNodeField(MAP, 1, 'port', 8080).nodes).toEqual({ '10.0.0.1:80': 3, 'b.example:8080': 1 });
    expect(setNodeField(MAP, 0, 'weight', 5).nodes).toEqual({ '10.0.0.1:80': 5, 'b.example': 1 });
    expect(addNodes(MAP, [{ host: 'c', port: 1, weight: 1 }]).nodes).toEqual({ '10.0.0.1:80': 3, 'b.example': 1, 'c:1': 1 });
  });

  it('turns a map into the array shape for a row it cannot hold, weights kept', () => {
    expect(setNodeField(MAP, 0, 'priority', 1).nodes).toEqual([
      { host: '10.0.0.1', port: 80, weight: 3, priority: 1 },
      { host: 'b.example', weight: 1 },
    ]);
    // No weight, no host, the same address twice.
    expect(setNodeField(MAP, 1, 'weight', undefined).nodes).toEqual([{ host: '10.0.0.1', port: 80, weight: 3 }, { host: 'b.example' }]);
    expect(setNodeField(MAP, 1, 'host', '').nodes).toEqual([{ host: '10.0.0.1', port: 80, weight: 3 }, { weight: 1 }]);
    expect(Array.isArray(duplicateNode(MAP, 0).nodes)).toBe(true);
  });

  it('edits an array row in place, keeping keys the form does not show', () => {
    expect(setNodeField(ARRAY, 0, 'weight', 7).nodes).toEqual([{ host: '10.0.0.1', port: 80, weight: 7, metadata: { zone: 'a' } }]);
    expect(setNodeField(ARRAY, 0, 'port', undefined).nodes).toEqual([{ host: '10.0.0.1', weight: 3, metadata: { zone: 'a' } }]);
    expect(duplicateNode(ARRAY, 0).nodes).toEqual([ARRAY.nodes[0], ARRAY.nodes[0]]);
  });

  it('adds to the array shape, also when there are no nodes yet', () => {
    expect(addNodes({}, [{ host: 'a', weight: 1 }]).nodes).toEqual([{ host: 'a', weight: 1 }]);
    expect(addNodes(ARRAY, [{ host: 'a', weight: 1 }]).nodes).toEqual([...ARRAY.nodes, { host: 'a', weight: 1 }]);
  });

  it('keeps an emptied list as an empty list of its shape', () => {
    expect(removeNode(ARRAY, 0).nodes).toEqual([]);
    expect(removeNode({ nodes: { a: 1 } }, 0).nodes).toEqual({});
    expect(removeNode(MAP, 0).nodes).toEqual({ 'b.example': 1 });
  });

  it('a paste replaces the address of the row it lands in and adds the rest after it', () => {
    const up = { nodes: [{ host: 'old', port: 1, weight: 4 }, { host: 'z', weight: 1 }] };
    expect(pasteNodes(up, 0, [{ host: 'a', port: 80 }, { host: 'b', port: 81 }]).nodes).toEqual([
      { host: 'a', port: 80, weight: 4 },
      { host: 'b', port: 81, weight: 1 },
      { host: 'z', weight: 1 },
    ]);
    // A host without a port keeps the row's port.
    expect(pasteNodes(up, 0, [{ host: 'a' }]).nodes).toEqual([{ host: 'a', port: 1, weight: 4 }, { host: 'z', weight: 1 }]);
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
