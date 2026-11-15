// A refused file's reason is kept by the box's changes, never with its text (fix round 1, R6): it stays
// until the user next changes the box (rule 5), masking on leaving is no such change, and no
// component state keeps a copy of a private key for it. The kit's useEditingState is wrapped to see
// every value it holds; nothing else of React is looked into.
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { renderTab } from '../../test/tab';
import { CertificateTab } from './CertificateTab';
import { fingerprintOf } from './fingerprint';
import { sslIssues } from './validate';

const held = vi.hoisted(() => ({ values: [] as unknown[] }));
vi.mock('../../ui', async (importOriginal) => {
  const ui = await importOriginal<typeof import('../../ui')>();
  return {
    ...ui,
    useEditingState: <T,>(initial: T | (() => T)) => {
      const pair = ui.useEditingState(initial);
      held.values.push(pair[0]);
      return pair;
    },
  };
});

beforeAll(async () => {
  await fingerprintOf(SEED_CERT);
});

const WHOLE_KEY = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/;

describe("a refused file's reason", () => {
  it('stays when the box is left (masking is not a change), and no state holds the key for it', async () => {
    const { user } = renderTab('ssls', CertificateTab, { status: 1 }, sslIssues, { isNew: true });
    const box = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    await user.click(box);
    await user.paste(SEED_CERT + SEED_KEY);
    // A file the box refuses, dropped while the box has focus and shows a whole key. The text's own
    // offer of the split stands (Task 16b, item 144): the reason is said beside it, with no
    // instruction (fix round 1, R3.1).
    fireEvent.drop(box, { dataTransfer: { files: [new File(['hello world'], 'notes.txt', { type: 'text/plain' })], getData: () => '' } });
    const reason = t('ssl.split.fileOverText', { reason: t('ssl.pem.bare.noCertLabel') });
    await waitFor(() => expect(box).toHaveAccessibleDescription(expect.stringContaining(reason) as string));
    expect(box).toHaveFocus();

    held.values.length = 0;
    act(() => box.blur());
    expect((box as HTMLTextAreaElement).value.startsWith(`${SEED_CERT}${t('ssl.pem.marker')}`)).toBe(true);
    expect(box).toHaveAccessibleDescription(expect.stringContaining(reason) as string);
    expect(held.values.length).toBeGreaterThan(0);
    for (const value of held.values) expect(WHOLE_KEY.test(JSON.stringify(value) ?? ''), JSON.stringify(value)?.slice(0, 80)).toBe(false);

    // The next change the user makes ends it.
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(SEED_CERT);
    expect(box).not.toHaveAccessibleDescription(expect.stringContaining(reason) as string);
  });
});
