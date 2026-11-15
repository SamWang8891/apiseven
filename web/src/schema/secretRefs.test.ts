// The schema check skips a secret reference exactly where APISIX's jsonschema does (fix round 1, R1):
// at every node whose `type` is absent or exactly "string", for a string starting with "$secret://"
// (case-sensitive) or, upper-cased, with "$ENV://" (core/schema.lua 37–45, secret.lua 268–281,
// jsonschema.lua 622–633). Composites follow, and for values that are not references the errors
// are the same as without the skip.
import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { everySchema, schemaOf } from '../test/pluginFixture';
import { fieldErrors, validatorFor } from './ajv';

const accepts = (schema: Obj, value: unknown) => (fieldErrors(schema, value) ?? []).length === 0;
const withA = (a: Obj): Obj => ({ type: 'object', properties: { a } });

describe('which strings are references, and at which nodes', () => {
  const STRICT = withA({ type: 'string', pattern: '^[a-z]+$', maxLength: 5 });

  it.each([
    ['$secret://vault/1/a', true],
    ['$secret://', true],
    ['$env://APISEVEN_HOST', true],
    ['$ENV://APISEVEN_HOST', true],
    ['$Env://APISEVEN_HOST', true],
    ['$SECRET://vault/1/a', false],
    ['x$env://y', false],
    [' $env://X', false],
    ['$envy://X', false],
  ])('%s at a string node: accepted %s', (value, skipped) => {
    expect(accepts(STRICT, { a: value })).toBe(skipped);
  });

  it('a node without a type is skipped too; an integer node, or one whose type is a list, is not', () => {
    expect(accepts(withA({ pattern: '^[a-z]+$' }), { a: '$env://X' })).toBe(true);
    expect(accepts(withA({ type: 'integer' }), { a: '$env://X' })).toBe(false);
    expect(accepts(withA({ type: ['string', 'null'], pattern: '^[a-z]+$' }), { a: '$env://X' })).toBe(false);
  });

  it('enum, minLength and format keywords are skipped with the node', () => {
    expect(accepts(withA({ type: 'string', enum: ['GET', 'POST'] }), { a: '$env://M' })).toBe(true);
    expect(accepts(withA({ type: 'string', minLength: 100 }), { a: '$env://M' })).toBe(true);
    expect(accepts(withA({ type: 'string', const: 'x' }), { a: '$secret://v/1/k' })).toBe(true);
  });

  it('a oneOf of two string branches: the outer node skips first; where it cannot (a list of types), both branches match and oneOf refuses, as in APISIX', () => {
    const both = [{ type: 'string' }, { type: 'string', minLength: 1 }];
    expect(accepts(withA({ oneOf: both }), { a: '$env://X' })).toBe(true);
    expect(accepts(withA({ type: 'string', oneOf: both }), { a: '$env://X' })).toBe(true);
    expect(accepts(withA({ type: ['string', 'integer'], oneOf: both }), { a: '$env://X' })).toBe(false);
    // Without the skip, a plain string matches both branches too: oneOf refuses it whatever the node.
    expect(accepts(withA({ oneOf: both }), { a: 'plain' })).toBe(false);
  });

  it('not and if around a reference: each sub-schema skips for itself', () => {
    // The `not` sub-schema accepts the reference, so `not` refuses it (the outer node has a type list, so it does not skip).
    expect(accepts(withA({ type: ['string', 'integer'], not: { type: 'string', pattern: '^x' } }), { a: '$env://X' })).toBe(false);
    // The `if` takes a reference as holding: its `then` applies.
    const conditional: Obj = { type: 'object', properties: { p: { type: 'string', enum: ['local', 'redis'] } }, if: { properties: { p: { enum: ['redis'] } } }, then: { required: ['host'] } };
    expect(fieldErrors(conditional, { p: '$env://P' })).toEqual([{ path: 'host', message: 'Required' }]);
    expect(accepts(conditional, { p: '$env://P', host: 'h' })).toBe(true);
  });

  it('a $ref is its target: a string target skips, an integer one does not', () => {
    const strings: Obj = { type: 'object', definitions: { s: { type: 'string', pattern: '^a' } }, properties: { a: { $ref: '#/definitions/s' } } };
    const integers: Obj = { type: 'object', definitions: { n: { type: 'integer' } }, properties: { a: { $ref: '#/definitions/n' } } };
    expect(accepts(strings, { a: '$env://X' })).toBe(true);
    expect(accepts(strings, { a: 'bad' })).toBe(false);
    expect(accepts(integers, { a: '$env://X' })).toBe(false);
    // A ref into a node the wrapping moved still resolves.
    const deep: Obj = { type: 'object', properties: { a: { type: 'string', pattern: '^a' }, b: { $ref: '#/properties/a' } } };
    expect(accepts(deep, { b: '$env://X' })).toBe(true);
    expect(fieldErrors(deep, { b: 'zz' })).toEqual([{ path: 'b', message: 'must match pattern "^a"' }]);
  });

  it('composes with failing open: a reference where an unreadable pattern was left out, and one under a dropped oneOf', () => {
    const PCRE = '\\Afoo\\z';
    expect(accepts(withA({ type: 'string', pattern: PCRE, maxLength: 3 }), { a: '$env://LONGER_THAN_THREE' })).toBe(true);
    expect(accepts(withA({ type: 'string', pattern: PCRE, maxLength: 3 }), { a: 'longer' })).toBe(false);
    expect(accepts(withA({ oneOf: [{ type: 'string', pattern: PCRE }, { type: 'integer' }] }), { a: '$env://X' })).toBe(true);
  });

  it('the form’s conditions use the same check (validatorFor)', () => {
    const when: Obj = { properties: { p: { enum: ['redis'] } } };
    expect(validatorFor(when)?.({ p: '$env://P' })).toBe(true);
    expect(validatorFor(when)?.({ p: 'local' })).toBe(false);
  });
});

describe('APISIX 3.20 plugin schemas', () => {
  it('proxy-rewrite: host (a pattern), method (an enum), uri (minLength and a pattern) take a reference', () => {
    const schema = schemaOf('proxy-rewrite');
    expect(fieldErrors(schema, { host: '$env://APISEVEN_UPSTREAM_HOST', method: '$env://M', uri: '$secret://vault/1/uri' })).toEqual([]);
    expect(fieldErrors(schema, { host: '$SECRET://x' })?.map((e) => e.path)).toEqual(['host']);
    expect(fieldErrors(schema, { host: 'x$env://y' })?.map((e) => e.path)).toEqual(['host']);
  });

  it('limit-count: count (a oneOf) takes one; rejected_code (an integer) does not; a policy reference holds the redis if, so redis_host is required', () => {
    const schema = schemaOf('limit-count');
    expect(fieldErrors(schema, { count: '$env://C', time_window: 60 })).toEqual([]);
    expect(fieldErrors(schema, { count: 1, time_window: 60, rejected_code: '$env://X' })?.map((e) => e.path)).toEqual(['rejected_code']);
    expect((fieldErrors(schema, { count: 1, time_window: 60, policy: '$env://P' }) ?? []).length).toBeGreaterThan(0);
  });

  it('_meta.error_response (a oneOf of a string and an object) takes one', () => {
    expect(fieldErrors(schemaOf('proxy-rewrite'), { _meta: { error_response: '$env://E' } })).toEqual([]);
  });
});

describe('for values that are not references, the errors are the same as without the skip', () => {
  /** Invalid configurations for every plugin schema: nothing, and each top-level property given each wrong kind of value. */
  function* invalid(schema: Obj): Generator<Obj> {
    yield {};
    const props = schema.properties && typeof schema.properties === 'object' ? Object.keys(schema.properties) : [];
    for (const key of props) for (const wrong of [12345, 'x', true, [], {}, [1, 'a'], { z: 1 }, -1]) yield { [key]: wrong };
  }

  // With the luaTables filter (as the editor checks plugins, plugin metadata and secret managers) and
  // without it: the filter is what lets a leaked wrapper error stand alone, so both runs are needed (R12.2).
  it.each([
    ['without luaTables', false],
    ['plugins, metadata and secret managers (luaTables)', true],
  ])('field errors, path and text, for each of them: %s', (_, luaTables) => {
    let compared = 0;
    let withErrors = 0;
    const differences: string[] = [];
    const leaks: string[] = [];
    for (const { label: name, schema } of everySchema()) {
      for (const value of invalid(schema)) {
        const before = fieldErrors(schema, value, { secretRefs: false, luaTables });
        const after = fieldErrors(schema, value, { luaTables });
        compared++;
        if (before && before.length > 0) withErrors++;
        if (JSON.stringify(before) !== JSON.stringify(after)) differences.push(`${name} ${JSON.stringify(value)}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
        for (const error of after ?? []) if (/must match "(?:else|then)" schema/.test(error.message)) leaks.push(`${name} ${JSON.stringify(value)}: ${error.path} ${error.message}`);
      }
    }
    expect(differences.slice(0, 5)).toEqual([]);
    expect(leaks.slice(0, 5)).toEqual([]);
    expect(compared).toBeGreaterThan(5000);
    expect(withErrors).toBeGreaterThan(2000);
  });

  it('a $ref target Ajv compiles as a function of its own (a recursive one): no wrapper error, the same paths (fix round 2, R12.1)', () => {
    const schema: Obj = { type: 'object', definitions: { node: { properties: { o: { type: 'object' }, child: { $ref: '#/definitions/node' } } } }, properties: { root: { $ref: '#/definitions/node' } } };
    expect(fieldErrors(schema, { root: { o: [] } }, { luaTables: true })).toEqual([]);
    expect(fieldErrors(schema, { root: { o: 5 } })).toEqual(fieldErrors(schema, { root: { o: 5 } }, { secretRefs: false }));
    expect(fieldErrors(schema, { root: { child: { o: 'x' } } })).toEqual(fieldErrors(schema, { root: { child: { o: 'x' } } }, { secretRefs: false }));
    expect(fieldErrors(schema, { root: { o: '$env://X' } })).toEqual([{ path: 'root.o', message: 'must be object' }]);
  });
});
