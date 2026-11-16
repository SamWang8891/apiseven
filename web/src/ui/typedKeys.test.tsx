// Codex final pass, fix round 1, Y2: text a kit control refuses stays in it and holds Save (addendum
// rule 20), but a PEM private-key block in that text is the one thing leaving changes: the block becomes
// the words for a key taken out of the page, the text stays held, and the held message (a refused
// Save's toast) is built from the replaced text, never from the key. While the user is in the box,
// nothing changes.
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { NumberInput, PendingProvider, TagInput, type PendingEntry } from './index';

const BODY = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAAkitTypedKey';
// One line: what a single-line box keeps of a pasted PEM.
const KEY = `-----BEGIN PRIVATE KEY----- ${BODY}${'A'.repeat(100)} -----END PRIVATE KEY-----`;
const MARKER = t('ssl.pem.marker');
const inPage = (text: string) => document.body.innerHTML.includes(text) || (document.body.textContent ?? '').includes(text);

function withProvider(ui: React.ReactNode) {
  const onChange = vi.fn<(entries: PendingEntry[]) => void>();
  const user = userEvent.setup();
  render(
    <PendingProvider onChange={onChange}>
      {ui}
      <button type="button">elsewhere</button>
    </PendingProvider>,
  );
  const held = () => (onChange.mock.calls.at(-1)?.[0] ?? []).map((e) => e.message);
  return { user, held, leave: () => user.click(screen.getByRole('button', { name: 'elsewhere' })) };
}

function Num() {
  const [value, setValue] = useState<number | undefined>(80);
  return <NumberInput label="Port" value={value} onChange={setValue} />;
}

function Tags({ validate }: { validate: (tag: string) => string | undefined }) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <>
      <TagInput label="Hosts" value={value} onChange={setValue} validate={validate} />
      <output aria-label="tags">{value.join(' ')}</output>
    </>
  );
}

describe('NumberInput: a key typed in, refused', () => {
  it('shows while in the box; once left it is the marker words, still held, and no held message ever quotes it', async () => {
    const { user, held, leave } = withProvider(<Num />);
    const input = screen.getByRole('spinbutton', { name: 'Port' });
    await user.clear(input);
    await user.paste(`x ${KEY}`);
    expect(input).toHaveValue(`x ${KEY}`);
    expect(held()).toEqual([t('ui.pending.notNumber', { field: 'Port', text: `x ${MARKER}` })]);

    await leave();
    expect(input).toHaveValue(`x ${MARKER}`);
    expect(inPage(BODY)).toBe(false);
    expect(held()).toEqual([t('ui.pending.notNumber', { field: 'Port', text: `x ${MARKER}` })]);
    expect(input).toHaveAttribute('aria-invalid', 'true');

    await user.clear(input);
    expect(held()).toEqual([]);
  });

  it('text without a key is left as typed', async () => {
    const { user, held, leave } = withProvider(<Num />);
    const input = screen.getByRole('spinbutton', { name: 'Port' });
    await user.clear(input);
    await user.type(input, 'abc');
    await leave();
    expect(input).toHaveValue('abc');
    expect(held()).toEqual([t('ui.pending.notNumber', { field: 'Port', text: 'abc' })]);
  });
});

describe('TagInput: a key pasted in, refused by validate', () => {
  const isHost = (tag: string) => (/^[a-z0-9.-]+$/.test(tag) ? undefined : 'Not a host name');
  // Refuses the key (it has dashes) but would take the marker words.
  const noDash = (tag: string) => (tag.includes('-') ? 'No dashes' : undefined);

  it('shows while in the box; once left it is the marker words, still held, and no held message ever quotes it', async () => {
    const { user, held, leave } = withProvider(<Tags validate={isHost} />);
    const input = screen.getByRole('textbox', { name: 'Hosts' });
    await user.click(input);
    await user.paste(KEY);
    expect(input).toHaveValue(KEY);
    expect(held()).toEqual([t('ui.pending.tag', { field: 'Hosts', text: MARKER, reason: 'Not a host name' })]);

    await leave();
    expect(input).toHaveValue(MARKER);
    expect(inPage(BODY)).toBe(false);
    expect(held()).toEqual([t('ui.pending.tag', { field: 'Hosts', text: MARKER, reason: 'Not a host name' })]);

    await user.clear(input);
    expect(held()).toEqual([]);
    expect(screen.getByRole('status', { name: 'tags' })).toHaveTextContent('');
  });

  it('the marker words are never added as a tag, even where validate would take them: Enter, leaving again, typing after them', async () => {
    const { user, held, leave } = withProvider(<Tags validate={noDash} />);
    const input = screen.getByRole('textbox', { name: 'Hosts' });
    await user.click(input);
    await user.paste(`ok ${KEY}`);
    // The part before the key passes and is added; the key stays, refused.
    expect(screen.getByRole('status', { name: 'tags' })).toHaveTextContent('ok');
    await leave();
    expect(input).toHaveValue(MARKER);
    await user.click(input);
    await user.keyboard('{Enter}');
    await leave();
    expect(screen.getByRole('status', { name: 'tags' })).toHaveTextContent(/^ok$/);
    expect(held()).toHaveLength(1);
    await user.click(input);
    await user.keyboard('{End} more{Enter}');
    expect(screen.getByRole('status', { name: 'tags' })).toHaveTextContent(/^ok$/);
    expect(held()).toEqual([t('ui.pending.tag', { field: 'Hosts', text: `${MARKER} more`, reason: t('ui.tags.keyOut') })]);
    expect(inPage(BODY)).toBe(false);
  });
});

// Fix round 2, Z1: a validate message that quotes the text it refuses is kept with the key taken out,
// so neither the field's error nor the held message (a refused Save's toast) ever holds the key.
describe('TagInput: a validate message that quotes the refused text', () => {
  const isPath = (tag: string) => (tag.startsWith('/') ? undefined : `"${tag}" is not a path`);
  const entries: [string, (user: ReturnType<typeof userEvent.setup>, input: HTMLElement) => Promise<void>][] = [
    ['typed', (user, input) => user.type(input, KEY)],
    [
      'dropped (one change, no paste)',
      (_user, input) => {
        fireEvent.change(input, { target: { value: KEY } });
        return Promise.resolve();
      },
    ],
  ];

  it.each(entries)('%s, then left: the key is in no text of the page, nor in the held message', async (_how, enter) => {
    const { user, held, leave } = withProvider(<Tags validate={isPath} />);
    const input = screen.getByRole('textbox', { name: 'Hosts' });
    await user.click(input);
    await enter(user, input);
    await leave();
    expect(inPage(BODY)).toBe(false);
    expect(input).toHaveValue(MARKER);
    expect(screen.getByText(`"${MARKER}" is not a path`)).toBeInTheDocument();
    expect(held()).toEqual([t('ui.pending.tag', { field: 'Hosts', text: MARKER, reason: `"${MARKER}" is not a path` })]);
  });

  it('a message about key-free text is kept as it came', async () => {
    const { user, held, leave } = withProvider(<Tags validate={isPath} />);
    await user.type(screen.getByRole('textbox', { name: 'Hosts' }), 'abc');
    await leave();
    expect(screen.getByText('"abc" is not a path')).toBeInTheDocument();
    expect(held()).toEqual([t('ui.pending.tag', { field: 'Hosts', text: 'abc', reason: '"abc" is not a path' })]);
  });
});
