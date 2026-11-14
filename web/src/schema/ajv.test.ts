import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { schemaOf } from '../test/pluginFixture';
import { schemaErrors, validatorFor, withDefaults } from './ajv';

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
