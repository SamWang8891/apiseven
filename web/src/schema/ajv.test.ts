import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { schemaOf } from '../test/pluginFixture';
import { fieldErrors, schemaErrors, schemaGaps, specificErrors, validatorFor, withDefaults } from './ajv';

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

describe('failing open (Task 16 B18): what JavaScript cannot read is left to APISIX, never refused', () => {
  // PCRE's \A and \z (openwhisk in 3.20): an invalid escape for JavaScript's unicode RegExp.
  const PCRE = '\\A([\\w]|[\\w][\\w@ .-]*[\\w@.-]+)\\z';

  it('a pattern JavaScript cannot compile is skipped alone: the schema still checks everything else', () => {
    const schema: Obj = { type: 'object', required: ['name'], properties: { name: { type: 'string', pattern: PCRE, maxLength: 5 } } };
    expect(validatorFor(schema)).not.toBeNull();
    expect(fieldErrors(schema, { name: 'hello' })).toEqual([]);
    expect(fieldErrors(schema, { name: 'not matched by a JS reading of \\A' })).toEqual([{ path: 'name', message: 'must NOT have more than 5 characters' }]);
    expect(fieldErrors(schema, {})).toEqual([{ path: 'name', message: t('schema.required') }]);
    expect(schemaGaps(schema)).toEqual(['patterns']);
  });

  it('a patternProperties key JavaScript cannot compile is skipped, and keys it may have meant are not refused as additional', () => {
    const schema: Obj = { type: 'object', patternProperties: { [PCRE]: { type: 'integer' } }, additionalProperties: false };
    expect(fieldErrors(schema, { anything: 'text' })).toEqual([]);
    // What was left out is the keys the pattern covers, and the check of keys no pattern names.
    expect(schemaGaps(schema)).toEqual(['keys']);
  });

  it('an unknown format produces no issue', () => {
    const schema: Obj = { type: 'object', properties: { at: { type: 'string', format: 'lua-time' } } };
    expect(fieldErrors(schema, { at: 'whenever' })).toEqual([]);
    expect(schemaGaps(schema)).toBeUndefined();
  });

  it('a schema Ajv cannot compile produces no issue, and says so', () => {
    expect(fieldErrors({ properties: { a: { $ref: '#/nope' } } }, { a: 1 })).toBeNull();
    expect(schemaGaps({ properties: { a: { $ref: '#/nope' } } })).toBe('all');
  });

  it('a schema it reads whole has no gaps', () => {
    expect(schemaGaps(schemaOf('limit-count'))).toBeUndefined();
  });

  it("openwhisk (3.20): its PCRE patterns are skipped, its other checks run", () => {
    const openwhisk = schemaOf('openwhisk');
    expect(schemaGaps(openwhisk)).toEqual(['patterns']);
    expect(fieldErrors(openwhisk, { api_host: 'http://ow.test', service_token: 'u:p', namespace: 'guest', action: 'hello' })).toEqual([]);
    expect(fieldErrors(openwhisk, { api_host: 'http://ow.test', namespace: 'guest', action: 'hello' })).toEqual([{ path: 'service_token', message: t('schema.required') }]);
  });
});

describe('failing open never makes the check stricter: an unreadable pattern under not, if or oneOf leaves that whole check to APISIX (fix round 1, F1)', () => {
  // PCRE reads "bar" as not matching \Afoo\z, so APISIX accepts { a: 'bar' } under each schema below.
  const PCRE = '\\Afoo\\z';

  it('under not: the not goes, the rest of the node stays', () => {
    const schema: Obj = { type: 'object', properties: { a: { type: 'string', not: { type: 'string', pattern: PCRE } } } };
    expect(fieldErrors(schema, { a: 'bar' })).toEqual([]);
    expect(fieldErrors(schema, { a: 5 })).toEqual([{ path: 'a', message: 'must be string' }]);
    expect(schemaGaps(schema)).toEqual(['conditions']);
  });

  it('in a oneOf branch: the oneOf goes', () => {
    const schema: Obj = { type: 'object', properties: { a: { oneOf: [{ type: 'string', pattern: PCRE }, { type: 'string', maxLength: 3 }] } } };
    expect(fieldErrors(schema, { a: 'bar' })).toEqual([]);
    expect(schemaGaps(schema)).toEqual(['conditions']);
  });

  it('in an if: neither then nor else is applied', () => {
    const schema: Obj = { type: 'object', properties: { a: { type: 'string' } }, if: { properties: { a: { pattern: PCRE } } }, then: { required: ['b'] }, else: { required: ['c'] } };
    expect(fieldErrors(schema, { a: 'bar' })).toEqual([]);
    expect(fieldErrors(schema, { a: 1 })).toEqual([{ path: 'a', message: 'must be string' }]);
    expect(schemaGaps(schema)).toEqual(['conditions']);
  });

  it('nested: a not inside properties inside a oneOf branch takes the outermost oneOf', () => {
    const schema: Obj = { type: 'object', oneOf: [{ required: ['a'], properties: { a: { not: { pattern: PCRE } } } }, { required: ['z'] }] };
    expect(fieldErrors(schema, { a: 'bar' })).toEqual([]);
    expect(schemaGaps(schema)).toEqual(['conditions']);
  });

  it('a not inside a not: still the outermost, so no double negation turns stricter', () => {
    const schema: Obj = { type: 'object', properties: { a: { not: { not: { type: 'string', pattern: PCRE } } } } };
    expect(fieldErrors(schema, { a: 'bar' })).toEqual([]);
  });

  it('where removing only loosens (anyOf, allOf, then, else, items) only the pattern goes', () => {
    const schema: Obj = { type: 'object', properties: { a: { anyOf: [{ type: 'string', pattern: PCRE }, { type: 'integer' }] }, l: { type: 'array', items: { type: 'string', pattern: PCRE, maxLength: 2 } } } };
    expect(fieldErrors(schema, { a: 'bar', l: ['xy'] })).toEqual([]);
    expect(fieldErrors(schema, { l: ['xyz'] })).toEqual([{ path: 'l.0', message: 'must NOT have more than 2 characters' }]);
    expect(schemaGaps(schema)).toEqual(['patterns']);
  });

  it('in definitions (which a $ref may reach from anywhere): the whole schema is left to APISIX', () => {
    const schema: Obj = { type: 'object', definitions: { x: { type: 'string', pattern: PCRE } }, properties: { a: { not: { $ref: '#/definitions/x' } } } };
    expect(fieldErrors(schema, { a: 'bar' })).toBeNull();
    expect(schemaGaps(schema)).toBe('all');
  });

  it('a property named like a keyword is a property, not a keyword', () => {
    const schema: Obj = { type: 'object', properties: { not: { type: 'string', pattern: PCRE }, if: { type: 'integer' } } };
    expect(fieldErrors(schema, { not: 'bar', if: 'x' })).toEqual([{ path: 'if', message: 'must be integer' }]);
    expect(schemaGaps(schema)).toEqual(['patterns']);
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

describe('fieldErrors with luaTables (as APISIX validates: an empty table is a list and an object)', () => {
  const schema = { type: 'object', properties: { list: { type: 'array', minItems: 0 }, map: { type: 'object' }, either: { type: ['object', 'array'] }, text: { type: 'string' } } };
  it('takes an empty {} as a list and an empty [] as an object; refuses a non-empty one of the other type, and an empty table for text', () => {
    expect(fieldErrors(schema, { list: {}, map: [] }, { luaTables: true })).toEqual([]);
    expect(fieldErrors(schema, { list: {}, map: [] })?.map((e) => e.path)).toEqual(['list', 'map']);
    expect(fieldErrors(schema, { list: { a: 1 }, map: ['x'] }, { luaTables: true })?.map((e) => e.path)).toEqual(['list', 'map']);
    expect(fieldErrors(schema, { text: {} }, { luaTables: true })?.map((e) => e.path)).toEqual(['text']);
    expect(fieldErrors(schema, [], { luaTables: true })).toEqual([]);
  });
});

describe('specificErrors', () => {
  it('leaves errors outside any combinator alone', () => {
    const schema: Obj = { type: 'object', properties: { a: { type: 'string' } } };
    const errors = schemaErrors(schema, { a: 1 }) ?? [];
    expect(specificErrors(schema, { a: 1 }, errors)).toEqual(errors);
  });
});
