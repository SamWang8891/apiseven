import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { schemaOf } from '../test/pluginFixture';
import { fieldErrors, schemaErrors, specificErrors, validatorFor, withDefaults } from './ajv';

describe('validatorFor', () => {
  it('compiles once per schema object', () => {
    const schema: Obj = { type: 'integer' };
    const first = validatorFor(schema);
    expect(first).not.toBeNull();
    expect(validatorFor(schema)).toBe(first);
    expect(first?.(3)).toBe(true);
    expect(first?.('3')).toBe(false);
  });

  it('gives null for a schema Ajv cannot compile, without throwing', () => {
    expect(validatorFor({ type: 5 })).toBeNull();
    expect(validatorFor({ properties: { a: { $ref: '#/nope' } } })).toBeNull();
  });

  it('accepts draft-04 idioms: a $schema URI and boolean exclusiveMinimum / exclusiveMaximum', () => {
    const v = validatorFor({
      $schema: 'http://json-schema.org/draft-04/schema#',
      type: 'object',
      properties: { n: { type: 'number', minimum: 0, exclusiveMinimum: true, maximum: 10, exclusiveMaximum: false } },
    });
    expect(v?.({ n: 0 })).toBe(false);
    expect(v?.({ n: 0.5 })).toBe(true);
    expect(v?.({ n: 10 })).toBe(true);
  });

  it('compiles schemas that share an $id side by side', () => {
    expect(validatorFor({ $id: 'x', type: 'string' })?.('a')).toBe(true);
    expect(validatorFor({ $id: 'x', type: 'integer' })?.(1)).toBe(true);
  });
});

describe('withDefaults', () => {
  it('fills missing properties from their defaults, nested ones and array items too, in a copy', () => {
    const schema: Obj = {
      type: 'object',
      properties: {
        policy: { type: 'string', default: 'local' },
        redis: { type: 'object', properties: { port: { default: 6379 } } },
        rules: { type: 'array', items: { type: 'object', properties: { n: { default: 1 } } } },
        given: { default: 'x' },
      },
    };
    const value = { redis: {}, rules: [{}, { n: 5 }], given: 'mine' };
    expect(withDefaults(schema, value)).toEqual({ policy: 'local', redis: { port: 6379 }, rules: [{ n: 1 }, { n: 5 }], given: 'mine' });
    expect(value).toEqual({ redis: {}, rules: [{}, { n: 5 }], given: 'mine' });
  });

  it('leaves non-objects alone', () => {
    expect(withDefaults({ properties: { a: { default: 1 } } }, 'text')).toBe('text');
  });
});

describe('schemaErrors', () => {
  const limitCount = schemaOf('limit-count');

  it('applies defaults before if/then, as APISIX does: limit-count without a policy is local, not redis', () => {
    expect(schemaErrors(limitCount, { count: 1, time_window: 60 })).toEqual([]);
    const redis = schemaErrors(limitCount, { count: 1, time_window: 60, policy: 'redis' });
    expect(redis?.some((e) => e.keyword === 'required' && (e.params as Obj).missingProperty === 'redis_host')).toBe(true);
  });

  it('gives null when the schema does not compile', () => {
    expect(schemaErrors({ type: 5 }, {})).toBeNull();
  });
});

describe('fieldErrors', () => {
  const limitCount = schemaOf('limit-count');

  it('gives [] for a valid value and null for a schema that does not compile', () => {
    expect(fieldErrors(limitCount, { count: 1, time_window: 60 })).toEqual([]);
    expect(fieldErrors({ type: 5 }, {})).toBeNull();
  });

  it('uses dotted paths, array indices as numbers', () => {
    const schema: Obj = { type: 'object', properties: { rules: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' } } } } } };
    expect(fieldErrors(schema, { rules: [{ n: 1 }, { n: 'x' }] })).toEqual([{ path: 'rules.1.n', message: 'must be integer' }]);
  });

  it('points a missing required property at its own path, where it reads "Required"', () => {
    const schema: Obj = { type: 'object', properties: { redis: { type: 'object', properties: { host: { type: 'string' } }, required: ['host'] } } };
    expect(fieldErrors(schema, { redis: {} })).toEqual([{ path: 'redis.host', message: 'Required' }]);
  });

  it('decodes JSON-pointer escapes in keys', () => {
    const schema: Obj = { type: 'object', additionalProperties: { type: 'integer' } };
    expect(fieldErrors(schema, { 'a/b': 'x' })).toEqual([{ path: 'a/b', message: 'must be integer' }]);
  });

  it('names the property that is not allowed, and the values an enum allows', () => {
    const schema: Obj = { type: 'object', properties: { policy: { enum: ['local', 'redis'] } }, additionalProperties: false };
    expect(fieldErrors(schema, { policy: 'x', extra: 1 })).toEqual(
      expect.arrayContaining([
        { path: 'policy', message: 'must be one of "local", "redis"' },
        { path: '', message: 'must NOT have additional property "extra"' },
      ]),
    );
  });

  it('limit-count without count or rules: the first set of required fields, not the oneOf summary', () => {
    expect(fieldErrors(limitCount, {})).toEqual([
      { path: 'count', message: 'Required' },
      { path: 'time_window', message: 'Required' },
    ]);
  });

  it('limit-count with count only: the set the value has started on', () => {
    expect(fieldErrors(limitCount, { count: 5 })).toEqual([{ path: 'time_window', message: 'Required' }]);
  });

  it('limit-count with rules of the wrong type: the branch the value chose, not the other one', () => {
    expect(fieldErrors(limitCount, { rules: 'x' })).toEqual([{ path: 'rules', message: 'must be array' }]);
  });

  it('keeps the summary when no branch has an error of its own (a value matching both sides of a oneOf)', () => {
    const schema: Obj = { oneOf: [{ type: 'integer' }, { type: 'number' }] };
    expect(fieldErrors(schema, 3)).toEqual([{ path: '', message: 'must match exactly one schema in oneOf' }]);
  });

  it('drops the if summary and keeps the failing branch', () => {
    const schema = schemaOf('limit-count');
    expect(fieldErrors(schema, { count: 1, time_window: 60, policy: 'redis' })).toEqual([
      { path: 'redis_host', message: 'Required' },
    ]);
  });

  it('a mistyped key in an anyOf of object forms: the form whose properties the value uses', () => {
    const headers = (schemaOf('proxy-rewrite').properties as Obj).headers as Obj;
    const errors = fieldErrors(headers, { set: true }) ?? [];
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe('set');
    expect(errors[0]?.message).toBe('must be object');
  });
});

describe('specificErrors', () => {
  it('leaves errors outside any combinator alone', () => {
    const schema: Obj = { type: 'object', properties: { a: { type: 'string' } } };
    const errors = schemaErrors(schema, { a: 1 }) ?? [];
    expect(specificErrors(schema, { a: 1 }, errors)).toEqual(errors);
  });
});
