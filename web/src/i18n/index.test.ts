import { describe, expect, it } from 'vitest';
import { en } from './en';
import { format } from './format';
import { t } from './index';

describe('format', () => {
  it('fills {placeholders} from vars, numbers included', () => {
    expect(format('{name} has {count} routes', { name: 'Ada', count: 3 })).toBe('Ada has 3 routes');
  });

  it('fills every occurrence of a placeholder', () => {
    expect(format('{x} and {x}', { x: 'a' })).toBe('a and a');
  });

  it('leaves placeholders without a value untouched', () => {
    expect(format('{name} has {count} routes', { name: 'Ada' })).toBe('Ada has {count} routes');
  });

  it('returns the template unchanged without vars', () => {
    expect(format('{name}')).toBe('{name}');
  });
});

describe('t', () => {
  it('returns the English string for a key', () => {
    expect(t('app.name')).toBe(en['app.name']);
  });

  it('returns the key itself when it is missing, so the gap is visible', () => {
    expect(t('no.such.key')).toBe('no.such.key');
  });
});
