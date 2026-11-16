import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { MASK } from '../schema/secrets';
import { pluginSummary } from './summary';

describe('pluginSummary', () => {
  it('an empty config, or one with only _meta, runs on its defaults', () => {
    expect(pluginSummary('key-auth', {})).toBe(t('pl.summary.defaults'));
    expect(pluginSummary('key-auth', { _meta: { disable: true } })).toBe('defaults');
  });

  it('the first three scalars as key=value, then how many more', () => {
    expect(pluginSummary('limit-count', { count: 2, time_window: 60, rejected_code: 429 })).toBe('count=2, time_window=60, rejected_code=429');
    expect(pluginSummary('limit-count', { count: 2, time_window: 60, rejected_code: 429, key: 'remote_addr', policy: 'local' })).toBe(
      'count=2, time_window=60, rejected_code=429, +2 more',
    );
  });

  it('scalars come before lists and objects', () => {
    expect(pluginSummary('proxy-rewrite', { headers: { set: { a: '1' } }, uri: '/get' })).toBe('uri=/get, headers={…}');
  });

  it('lists as key=[n], objects as key={…}', () => {
    expect(pluginSummary('ip-restriction', { whitelist: ['10.0.0.0/8', '127.0.0.1'] })).toBe('whitelist=[2]');
    expect(pluginSummary('cors', { allow_origins: '*', nested: {} })).toBe('allow_origins=*, nested={…}');
  });

  it('quotes strings only when they contain spaces', () => {
    expect(pluginSummary('ip-restriction', { message: 'Access denied', mode: 'x' })).toBe('message="Access denied", mode=x');
  });

  it('elides long values', () => {
    const s = pluginSummary('proxy-rewrite', { uri: `/${'a'.repeat(60)}` });
    expect(s.startsWith('uri=/aaaa')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s.length).toBeLessThan(40);
  });

  it('booleans and null read as written', () => {
    expect(pluginSummary('cors', { allow_credential: true, x: null })).toBe('allow_credential=true, x=null');
  });

  it('skips _meta', () => {
    expect(pluginSummary('limit-count', { _meta: { priority: 1 }, count: 1 })).toBe('count=1');
  });

  it('never runs longer than 80 characters', () => {
    const conf = { a_long_key_name: 'x'.repeat(30), another_long_key: 'y'.repeat(30), third_key_here: 'z'.repeat(30), d: 1 };
    const s = pluginSummary('p', conf);
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s).toMatch(/, \+\d more$/);
    for (let n = 1; n <= 12; n++) {
      const many = Object.fromEntries(Array.from({ length: n }, (_, i) => [`key_number_${i}`, `value number ${i} with words`]));
      expect(pluginSummary('p', many).length).toBeLessThanOrEqual(80);
    }
  });

  it('masks secrets: encrypt_fields given, and keys named like secrets', () => {
    expect(pluginSummary('key-auth', { key: 'my-api-key' }, ['key'])).toBe('key=••••••••');
    expect(pluginSummary('limit-count', { count: 1, redis_password: 'hunter2' })).toBe('count=1, redis_password=••••••••');
  });
});

// Fix round 1, R1: text holding a PEM private key is masked whatever its name.
describe('pluginSummary and private keys', () => {
  it('masks a value that holds a PEM private key', () => {
    expect(pluginSummary('x', { sp_cert: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----', a: 1 })).toBe(`sp_cert=${MASK}, a=1`);
  });
});
