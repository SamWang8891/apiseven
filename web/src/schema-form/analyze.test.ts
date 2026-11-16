import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { everySchema, schemaOf } from '../test/pluginFixture';
import { isObj } from '../schema/refs';
import { analyze, type Node, type ObjectNode, type ObjectPart, type Prop } from './analyze';
import { fallbackStats } from './stats';

function objectOf(node: Node): ObjectNode {
  if (node.kind !== 'object') throw new Error(`expected an object node, got ${node.kind}`);
  return node;
}

function propOf(node: Node, key: string): Prop {
  const prop = objectOf(node).props.find((p) => p.key === key);
  if (!prop) throw new Error(`no prop ${key}`);
  return prop;
}

/** A prop declared in one of the object's conditional branches. */
function branchProp(node: Node, key: string): Prop | undefined {
  const all: Prop[] = [];
  const collect = (part: { props: Prop[]; conditionals: { then?: unknown; else?: unknown }[] }) => {
    all.push(...part.props);
    for (const c of part.conditionals) for (const p of [c.then, c.else]) if (p) collect(p as typeof part);
  };
  collect(objectOf(node));
  return all.find((p) => p.key === key);
}

describe('analyze: every plugin schema in the fixture (Review Focus 2a)', () => {
  it('analyses every schema, consumer_schema and metadata_schema without throwing', () => {
    const all = everySchema();
    expect(all.length).toBeGreaterThan(140);
    for (const { schema, label } of all) {
      let node: Node | undefined;
      expect(() => (node = analyze(schema)), label).not.toThrow();
      expect(node?.kind, label).toBe('object');
    }
  });

  it('analyses every schema in under 500 ms in total', () => {
    const all = everySchema().map((s) => structuredClone(s.schema)); // fresh objects: no memo hits
    const start = performance.now();
    for (const schema of all) analyze(schema);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('shows fewer than 15% of all top-level properties as JSON editors', () => {
    let props = 0;
    const offenders: string[] = [];
    for (const { schema, label } of everySchema()) {
      const stats = fallbackStats(schema);
      props += stats.props;
      offenders.push(...stats.json.map((key) => `${label}.${key}`));
    }
    const ratio = offenders.length / props;
    expect(ratio, `${offenders.length}/${props} fall back to JSON:\n${offenders.join('\n')}`).toBeLessThan(0.15);
  });

  it('memoises per schema object (and per extra encrypt fields)', () => {
    const schema = schemaOf('limit-count');
    expect(analyze(schema)).toBe(analyze(schema));
    expect(analyze(schema, { encryptFields: ['key'] })).toBe(analyze(schema, { encryptFields: ['key'] }));
    expect(analyze(schema, { encryptFields: ['key'] })).not.toBe(analyze(schema));
  });
});

describe('analyze: real plugins', () => {
  it('limit-count: policy is a select of local, redis, redis-cluster; count is an integer that also takes text', () => {
    const node = analyze(schemaOf('limit-count'));
    expect(propOf(node, 'policy').node).toMatchObject({ kind: 'string', enum: expect.arrayContaining(['local', 'redis', 'redis-cluster']) as unknown });
    expect(propOf(node, 'policy').default).toBe('local');
    expect(propOf(node, 'count').node).toMatchObject({ kind: 'number', integer: true, min: 0, exclusiveMin: true, orText: true });
    // count + time_window, or rules: the 3.20 schema says so with a oneOf of required sets.
    expect(objectOf(node).alternatives).toEqual([{ mode: 'oneOf', sets: [['count', 'time_window'], ['rules']] }]);
  });

  it('limit-count: the redis fields come from if/then/else, each branch with its own required ones', () => {
    const node = objectOf(analyze(schemaOf('limit-count')));
    expect(node.props.some((p) => p.key === 'redis_host')).toBe(false);
    expect(branchProp(node, 'redis_host')?.node.kind).toBe('string');
    expect(branchProp(node, 'redis_cluster_nodes')?.node.kind).toBe('array-scalar');
    const redis = node.conditionals[0];
    expect(redis?.when).toEqual({ properties: { policy: { enum: ['redis'] } } });
    expect(redis?.then?.props.find((p) => p.key === 'redis_host')?.required).toBe(true);
  });

  it('proxy-rewrite: headers is a variant (add/set/remove, or a plain map), not JSON', () => {
    const headers = propOf(analyze(schemaOf('proxy-rewrite')), 'headers').node;
    expect(headers.kind).toBe('variant');
    if (headers.kind !== 'variant') return;
    expect(headers.options.map((o) => o.label)).toEqual(['add, remove, set', 'Key → value map']);
    const [structured, plain] = headers.options;
    expect(structured?.matches({ set: { 'X-Api': 'v1' }, remove: ['X-Old'] })).toBe(true);
    expect(plain?.matches({ set: { 'X-Api': 'v1' } })).toBe(false);
    expect(plain?.matches({ 'X-Api': 'v1', 'X-Count': 2 })).toBe(true);
    expect(structured?.matches({ 'X-Api': 'v1' })).toBe(false);
    expect(propOf(analyze(schemaOf('proxy-rewrite')), 'uri').node).toMatchObject({ kind: 'string', multiline: false, mono: true });
  });

  it('key-auth consumer schema: key is a secret (its schema lists it in encrypt_fields)', () => {
    expect(propOf(analyze(schemaOf('key-auth', 'consumer_schema')), 'key').node).toMatchObject({ kind: 'string', secret: true });
  });

  it('reads encrypt_fields paths through nested objects and arrays', () => {
    const oidc = analyze(schemaOf('openid-connect'));
    const session = propOf(oidc, 'session').node;
    expect(propOf(session, 'secret').node).toMatchObject({ secret: true });
    const brokers = propOf(analyze(schemaOf('kafka-logger')), 'brokers').node;
    if (brokers.kind !== 'array-object') throw new Error(brokers.kind);
    expect(propOf(propOf(brokers.item, 'sasl_config').node, 'password').node).toMatchObject({ secret: true });
  });

  it('takes extra encrypt fields from the caller', () => {
    const node = analyze(schemaOf('limit-count'), { encryptFields: ['group'] });
    expect(propOf(node, 'group').node).toMatchObject({ secret: true });
    expect(propOf(analyze(schemaOf('limit-count')), 'group').node).toMatchObject({ secret: false });
  });

  it('marks secret-looking names secret, but not URLs or ids that merely contain the word', () => {
    const oidc = analyze(schemaOf('openid-connect'));
    expect(propOf(oidc, 'client_secret').node).toMatchObject({ secret: true });
    expect(propOf(oidc, 'introspection_endpoint').node).toMatchObject({ secret: false, mono: true });
    expect(propOf(oidc, 'client_rsa_private_key_id').node).toMatchObject({ secret: false });
    expect(propOf(analyze(schemaOf('authz-keycloak')), 'token_endpoint').node).toMatchObject({ secret: false, multiline: false });
  });

  it('makes PEM, Lua and long free text multi-line, and keeps URIs on one line however long', () => {
    expect(propOf(analyze(schemaOf('openid-connect')), 'client_rsa_private_key').node).toMatchObject({ multiline: true });
    expect(propOf(analyze(schemaOf('jwt-auth', 'consumer_schema')), 'key').node).toMatchObject({ multiline: false });
    expect(propOf(analyze(schemaOf('degraphql')), 'query').node).toMatchObject({ multiline: true });
    expect(propOf(analyze(schemaOf('proxy-rewrite')), 'uri').node).toMatchObject({ multiline: false });
    const functions = propOf(analyze(schemaOf('serverless-pre-function')), 'functions').node;
    expect(functions).toMatchObject({ kind: 'array-object', item: { kind: 'string', multiline: true } });
  });

  it('merges an anyOf of strings into one field that says what it accepts (ip-restriction)', () => {
    const whitelist = propOf(analyze(schemaOf('ip-restriction')), 'whitelist').node;
    expect(whitelist).toMatchObject({ kind: 'array-scalar', item: { kind: 'string', accepts: ['IPv4', 'IPv4/CIDR', 'IPv6', 'IPv6/CIDR'] } });
  });

  it('tells options of different types apart (gzip types: a list or "*")', () => {
    const types = propOf(analyze(schemaOf('gzip')), 'types').node;
    if (types.kind !== 'variant') throw new Error(types.kind);
    expect(types.options.map((o) => o.label)).toEqual(['List', '*']);
    expect(types.options[0]?.matches(['text/html'])).toBe(true);
    expect(types.options[1]?.matches('*')).toBe(true);
    expect(types.options[0]?.matches('*')).toBe(false);
  });

  it('jwt-auth consumer: choosing an RS/ES algorithm brings in a required public_key (dependencies + oneOf)', () => {
    const node = objectOf(analyze(schemaOf('jwt-auth', 'consumer_schema')));
    expect(node.props.some((p) => p.key === 'public_key')).toBe(false);
    const dependency = node.conditionals[0];
    expect(dependency?.when).toEqual({ required: ['algorithm'] });
    const rs = dependency?.then?.conditionals[1];
    expect(rs?.when).toMatchObject({ properties: { algorithm: { enum: expect.arrayContaining(['RS256']) as unknown } } });
    expect(rs?.then?.props.find((p) => p.key === 'public_key')?.required).toBe(true);
  });

  it('turns patternProperties that are plain names into fields (ai-proxy auth: header, query, gcp, aws)', () => {
    const auth = propOf(analyze(schemaOf('ai-proxy')), 'auth').node;
    expect(objectOf(auth).props.map((p) => p.key).sort()).toEqual(['aws', 'gcp', 'header', 'query']);
    expect(propOf(auth, 'header').node).toMatchObject({ kind: 'map', value: { kind: 'string', secret: true } });
  });

  it('keeps a free-form object as a map of anything, but a JSON schema value as JSON', () => {
    expect(propOf(analyze(schemaOf('http-logger')), 'log_format').node).toMatchObject({ kind: 'map', value: { kind: 'json' } });
    expect(propOf(analyze(schemaOf('request-validation')), 'body_schema').node.kind).toBe('json');
  });

  it('keeps APISIX vars expressions (arrays of arrays) as JSON', () => {
    expect(propOf(analyze(schemaOf('response-rewrite')), 'vars').node.kind).toBe('json');
  });
});

describe('analyze: schema dialects', () => {
  it('type ["string","integer"] is a number that also takes text', () => {
    const node = analyze({ type: 'object', properties: { ttl: { type: ['string', 'integer'], minimum: 1 } } });
    expect(propOf(node, 'ttl').node).toEqual({ kind: 'number', integer: true, min: 1, orText: true });
  });

  it('exclusiveMinimum as a draft-04 boolean or a draft-07 number', () => {
    const node = analyze({
      properties: {
        a: { type: 'number', minimum: 0, exclusiveMinimum: true },
        b: { type: 'number', exclusiveMinimum: 0 },
        c: { type: 'integer', minimum: 1, maximum: 65535 },
      },
    });
    expect(propOf(node, 'a').node).toEqual({ kind: 'number', integer: false, min: 0, exclusiveMin: true });
    expect(propOf(node, 'b').node).toEqual({ kind: 'number', integer: false, min: 0, exclusiveMin: true });
    expect(propOf(node, 'c').node).toEqual({ kind: 'number', integer: true, min: 1, max: 65535 });
  });

  it('follows $ref into definitions and $defs, keeping the referring description', () => {
    const node = analyze({
      type: 'object',
      definitions: { port: { type: 'integer', minimum: 1, maximum: 65535 } },
      $defs: { host: { type: 'string', description: 'from the def' } },
      properties: { port: { $ref: '#/definitions/port', description: 'the port' }, host: { $ref: '#/$defs/host' } },
    });
    expect(propOf(node, 'port')).toMatchObject({ description: 'the port', node: { kind: 'number', min: 1, max: 65535 } });
    expect(propOf(node, 'host')).toMatchObject({ description: 'from the def', node: { kind: 'string', mono: true } });
  });

  it('enum of non-strings and const become an enum node; a string const a one-option select', () => {
    const node = analyze({ properties: { code: { enum: [200, 404] }, flag: { const: true }, mode: { const: 'x' } } });
    expect(propOf(node, 'code').node).toEqual({ kind: 'enum', values: [200, 404] });
    expect(propOf(node, 'flag').node).toEqual({ kind: 'enum', values: [true] });
    expect(propOf(node, 'mode').node).toMatchObject({ kind: 'string', enum: ['x'] });
  });

  it('anyOf of required sets on an object is a plain object with alternatives; minItems/uniqueItems kept', () => {
    const node = objectOf(
      analyze({
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'integer' }, minItems: 1, uniqueItems: true } },
        anyOf: [{ required: ['a'] }, { required: ['b'] }],
        not: { required: ['c'] },
      }),
    );
    expect(node.alternatives).toEqual([{ mode: 'anyOf', sets: [['a'], ['b']] }]);
    expect(propOf(node, 'b').node).toEqual({ kind: 'array-scalar', item: { kind: 'number', integer: true }, minItems: 1, unique: true });
  });

  it('additionalProperties / patternProperties without fields is a map; additionalProperties false is noted', () => {
    expect(analyze({ type: 'object', additionalProperties: { type: 'integer' } })).toMatchObject({ kind: 'map', value: { kind: 'number' }, patterns: [] });
    expect(analyze({ type: 'object', patternProperties: { '^x-': { type: 'string' } } })).toMatchObject({ kind: 'map', patterns: ['^x-'] });
    expect(analyze({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false })).toMatchObject({ allowsExtra: false });
  });
});

describe('analyze: hostile schemas', () => {
  const circular: Obj = { type: 'object', properties: { self: { $ref: '#' }, loop: { $ref: '#/definitions/a' } }, definitions: { a: { $ref: '#/definitions/b' }, b: { $ref: '#/definitions/a' } } };
  const selfish: Obj = { type: 'object', properties: {} };
  (selfish.properties as Obj).me = selfish;
  let nested: Obj = { type: 'string' };
  for (let i = 0; i < 60; i++) nested = { oneOf: [nested, nested] };

  const cases: [string, unknown][] = [
    ['circular $ref', circular],
    ['a JS object that contains itself', selfish],
    ['properties: null', { type: 'object', properties: null }],
    ['type: 5', { type: 5 }],
    ['type: "frob"', { type: 'frob' }],
    ['items: []', { type: 'array', items: [] }],
    ['enum: {}', { type: 'string', enum: {} }],
    ['deeply nested oneOf', nested],
    ['oneOf: "x"', { oneOf: 'x' }],
    ['required: "a"', { type: 'object', properties: { a: { type: 'string' } }, required: 'a' }],
    ['properties: [1]', { type: 'object', properties: [1] }],
    ['a property that is null', { type: 'object', properties: { a: null, b: 7, c: true } }],
    ['$ref to nowhere', { $ref: '#/nope' }],
    ['$ref with a stray %', { $ref: '#/definitions/%' }],
    ['allOf of junk', { allOf: [1, null] }],
    ['if without then', { type: 'object', properties: { a: { type: 'string' } }, if: 5 }],
    ['dependencies of junk', { type: 'object', properties: { a: { type: 'string' } }, dependencies: { a: 5, b: [1, 'a'] } }],
    ['null', null],
    ['an array', [1, 2]],
  ];

  it.each(cases)('%s: analyses to a JSON node or a sane form, without throwing', (_name, schema) => {
    let node: Node | undefined;
    expect(() => (node = analyze(schema as Obj))).not.toThrow();
    expect(['json', 'object', 'string', 'map', 'array-scalar', 'variant']).toContain(node?.kind);
  });

  it('cuts cycles with a JSON node where the cycle closes', () => {
    const node = analyze(circular);
    expect(propOf(node, 'self').node.kind).toBe('json');
    expect(propOf(node, 'loop').node.kind).toBe('json');
    expect(propOf(analyze(selfish), 'me').node.kind).toBe('json');
  });

  it('gives up on a schema that multiplies, quickly', () => {
    const start = performance.now();
    analyze(structuredClone(nested));
    expect(performance.now() - start).toBeLessThan(500);
  });
});

// Fix round 1, R2.4: ObjectBody refuses a change that would hide a condition's field holding input by
// not emitting it (ObjectField.tsx onChild). That undoes the change on screen only when the field that
// changed shows the value it is given (a select, a switch, a text box, a list of tags). A field that
// keeps its own text (a number box, a JSON box, a secret's box, a map's rows) would go on showing the
// refused change. No 3.20 condition is keyed on one; this fails if one ever is.
describe('what the 3.20 schemas’ conditions are keyed on', () => {
  const CONTROLLED = (node: Node): boolean =>
    node.kind === 'boolean' || node.kind === 'enum' || node.kind === 'array-scalar' || (node.kind === 'string' && !node.secret && !node.multiline);

  function subjects(when: Obj | null): string[] {
    if (!when) return [];
    const props = isObj(when.properties) ? Object.keys(when.properties) : [];
    const required = Array.isArray(when.required) ? when.required.filter((k): k is string => typeof k === 'string') : [];
    return [...new Set([...props, ...required])];
  }

  /** Every object's conditions with the props they may be keyed on, through branches, lists, maps and variants. */
  function walk(node: Node, out: { key: string; node: Node | undefined }[]): void {
    if (node.kind === 'object') {
      const props: Prop[] = [];
      const parts: ObjectPart[] = [];
      const collect = (part: ObjectPart) => {
        parts.push(part);
        props.push(...part.props);
        for (const c of part.conditionals) for (const b of [c.then, c.else]) if (b) collect(b);
      };
      collect(node);
      for (const part of parts) for (const c of part.conditionals) for (const key of subjects(c.when)) out.push({ key, node: props.find((p) => p.key === key)?.node });
      for (const p of props) walk(p.node, out);
    } else if (node.kind === 'array-object' || node.kind === 'array-scalar') walk(node.item, out);
    else if (node.kind === 'map') walk(node.value, out);
    else if (node.kind === 'variant') for (const o of node.options) walk(o.node, out);
  }

  it('every subject is a field that shows the value it is given', () => {
    const seen: string[] = [];
    for (const { schema, label } of everySchema()) {
      const found: { key: string; node: Node | undefined }[] = [];
      walk(analyze(schema), found);
      for (const { key, node } of found) {
        if (!node) continue;
        seen.push(`${label}:${key}`);
        expect(CONTROLLED(node), `${label}: ${key} is a ${node.kind}`).toBe(true);
      }
    }
    expect(seen.length).toBeGreaterThan(10);
    // The check itself: a condition keyed on a number field is caught.
    const keyedOnNumber: { key: string; node: Node | undefined }[] = [];
    walk(analyze({ type: 'object', properties: { port: { type: 'integer' } }, if: { properties: { port: { const: 1 } } }, then: { properties: { tls: { type: 'boolean' } } } }), keyedOnNumber);
    expect(keyedOnNumber.map(({ key, node }) => [key, node && CONTROLLED(node)])).toEqual([['port', false]]);
  });
});
