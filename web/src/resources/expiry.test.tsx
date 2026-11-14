import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { ExpiryBadge, expiryTone } from './expiry';

const DAY = 86_400_000;
// Midday UTC, so the local date is the same in every time zone from UTC-11 to UTC+11.
const NOW = Date.UTC(2026, 10, 14, 12);

describe('expiryTone', () => {
  it('is none without an expiry', () => {
    expect(expiryTone(undefined, NOW)).toBe('none');
  });

  it('warns under 14 days, and is ok from 14 days on', () => {
    expect(expiryTone(NOW + 13.9 * DAY, NOW)).toBe('warn');
    expect(expiryTone(NOW + 1, NOW)).toBe('warn');
    expect(expiryTone(NOW + 14 * DAY, NOW)).toBe('ok');
    expect(expiryTone(NOW + 400 * DAY, NOW)).toBe('ok');
  });

  it('is danger once the expiry has passed (the expiry instant included)', () => {
    expect(expiryTone(NOW, NOW)).toBe('danger');
    expect(expiryTone(NOW - DAY, NOW)).toBe('danger');
  });

  it('measures from the current time by default', () => {
    expect(expiryTone(Date.now() + 30 * DAY)).toBe('ok');
    expect(expiryTone(Date.now() - 1000)).toBe('danger');
  });
});

describe('ExpiryBadge', () => {
  it('shows the days left and the date, warning under 14 days', () => {
    const { container } = render(<ExpiryBadge notAfter={NOW + 10 * DAY} now={NOW} />);
    const badge = container.querySelector('.ui-badge');
    expect(badge).toHaveClass('ui-badge--warn', 'expiry--warn');
    expect(badge).toHaveTextContent(`${t('expiry.days', { days: 10 })} 2026-11-24`);
  });

  it('is a plain ok badge further out', () => {
    const { container } = render(<ExpiryBadge notAfter={NOW + 69 * DAY} now={NOW} />);
    expect(container.querySelector('.ui-badge')).toHaveClass('ui-badge--ok', 'expiry--ok');
    expect(container).toHaveTextContent('69d 2027-01-22');
  });

  it('says expired with the date once past', () => {
    const { container } = render(<ExpiryBadge notAfter={NOW - 3 * DAY} now={NOW} />);
    const badge = container.querySelector('.ui-badge');
    expect(badge).toHaveClass('ui-badge--danger', 'expiry--danger');
    expect(badge).toHaveTextContent(t('expiry.expired', { date: '2026-11-11' }));
  });

  it('is a plain dash, not a badge, without an expiry', () => {
    const { container } = render(<ExpiryBadge notAfter={undefined} />);
    expect(container.querySelector('.ui-badge')).toBeNull();
    expect(screen.getByText(t('ui.empty'))).toBeInTheDocument();
  });
});
