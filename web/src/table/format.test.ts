import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { formatAbsolute, formatRelative } from './format';

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Epoch seconds `seconds` before NOW. */
const ago = (seconds: number): number => NOW / 1000 - seconds;

describe('formatRelative', () => {
  it.each([
    [0, 'just now'],
    [59, 'just now'],
    [60, '1m ago'],
    [59 * MIN, '59m ago'],
    [HOUR, '1h ago'],
    [23 * HOUR, '23h ago'],
    [24 * HOUR, '1d ago'],
    [29 * DAY, '29d ago'],
    [30 * DAY, '1mo ago'],
    [364 * DAY, '12mo ago'],
    [365 * DAY, '1y ago'],
    [3 * 365 * DAY, '3y ago'],
  ])('%is before now reads %s', (seconds, expected) => {
    expect(formatRelative(ago(seconds), NOW)).toBe(expected);
  });

  it('reads a time slightly in the future (clock skew) as just now', () => {
    expect(formatRelative(ago(-30), NOW)).toBe('just now');
  });

  it('is the empty mark without a time', () => {
    expect(formatRelative(undefined, NOW)).toBe(t('ui.empty'));
  });
});

describe('formatAbsolute', () => {
  it('formats local time as YYYY-MM-DD HH:mm:ss', () => {
    const local = new Date(2026, 0, 2, 3, 4, 5).getTime() / 1000;
    expect(formatAbsolute(local)).toBe('2026-01-02 03:04:05');
  });

  it('is the empty mark without a time', () => {
    expect(formatAbsolute(undefined)).toBe(t('ui.empty'));
  });
});
