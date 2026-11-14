// The kit's input holders and the pending-input guard: text a control shows but has not emitted is
// declared through usePending (named after the field), and a dialog's own form cannot be confirmed
// while a field in it holds such input.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { Button, ConfirmDialog, Dialog, KeyValueInput, NumberInput, PendingProvider, TagInput, TooltipProvider, type PendingEntry } from './index';

/** Renders `ui` under a provider; `held()` is what it holds now (the messages). */
function withProvider(ui: ReactNode) {
  const onChange = vi.fn<(entries: PendingEntry[]) => void>();
  const user = userEvent.setup();
  const result = render(<PendingProvider onChange={onChange}>{ui}</PendingProvider>);
  const held = () => (onChange.mock.calls.at(-1)?.[0] ?? []).map((e) => e.message);
  return { ...result, user, held };
}

function Num({ label = 'Port', integer }: { label?: string; integer?: boolean }) {
  const [value, setValue] = useState<number | undefined>(80);
  return <NumberInput label={label} integer={integer} value={value} onChange={setValue} />;
}

describe('NumberInput', () => {
  it('holds text that is not a number: named after its label, until it is a number or empty', async () => {
    const { user, held } = withProvider(<Num />);
    const input = screen.getByRole('spinbutton', { name: 'Port' });
    await user.clear(input);
    expect(held()).toEqual([]);
    await user.type(input, '-');
    expect(held()).toEqual([t('ui.pending.notNumber', { field: 'Port', text: '-' })]);
    await user.type(input, '5');
    expect(held()).toEqual([]);
    await user.clear(input);
    await user.type(input, '1e');
    expect(held()).toEqual([t('ui.pending.notNumber', { field: 'Port', text: '1e' })]);
    await user.clear(input);
    await user.type(input, 'abc');
    expect(held()).toEqual([t('ui.pending.notNumber', { field: 'Port', text: 'abc' })]);
    // Emptied: a real value (undefined), held by no one.
    await user.clear(input);
    expect(held()).toEqual([]);
  });

  it('holds a fraction in an integer field', async () => {
    const { user, held } = withProvider(<Num integer />);
    const input = screen.getByRole('spinbutton', { name: 'Port' });
    await user.clear(input);
    await user.type(input, '1.5');
    expect(held()).toEqual([t('ui.pending.notInteger', { field: 'Port', text: '1.5' })]);
  });

  it('keeps focus and caret while the hold comes and goes', async () => {
    const { user, held } = withProvider(<Num />);
    const input = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Port' });
    await user.click(input);
    input.setSelectionRange(1, 1);
    await user.keyboard('x');
    expect(input).toHaveValue('8x0');
    expect(held()).toHaveLength(1);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(2);
    await user.keyboard('{Backspace}');
    expect(held()).toEqual([]);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);
  });
});

function Tags({ validate }: { validate?: (tag: string) => string | undefined }) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <>
      <TagInput label="Hosts" value={value} onChange={setValue} validate={validate} />
      <output aria-label="tags">{value.join(' ')}</output>
    </>
  );
}

const isHost = (tag: string) => (/^[a-z0-9.-]+$/.test(tag) ? undefined : 'Not a host name');

describe('TagInput', () => {
  it('adds the typed text when the box is left, as Enter would; typing alone holds nothing', async () => {
    const { user, held } = withProvider(<Tags validate={isHost} />);
    await user.type(screen.getByRole('textbox', { name: 'Hosts' }), 'a.example.org');
    expect(held()).toEqual([]);
    await user.tab();
    expect(screen.getByRole('status', { name: 'tags' })).toHaveTextContent('a.example.org');
    expect(screen.getByRole('textbox', { name: 'Hosts' })).toHaveValue('');
  });

  it('holds text validate refuses (left in the box, flagged) until it is changed or added', async () => {
    const { user, held } = withProvider(<Tags validate={isHost} />);
    const input = screen.getByRole('textbox', { name: 'Hosts' });
    await user.type(input, 'bad host!');
    await user.tab();
    expect(input).toHaveValue('bad host!');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Not a host name')).toBeInTheDocument();
    expect(held()).toEqual([t('ui.pending.tag', { field: 'Hosts', text: 'bad host!', reason: 'Not a host name' })]);

    await user.clear(input);
    await user.type(input, 'b.example.org{Enter}');
    expect(held()).toEqual([]);
    expect(screen.getByRole('status', { name: 'tags' })).toHaveTextContent('b.example.org');
  });
});

function Labels({ initial = {} }: { initial?: Record<string, string> }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <KeyValueInput label="Labels" value={value} onChange={setValue} />
      <output aria-label="map">{JSON.stringify(value)}</output>
    </>
  );
}

describe('KeyValueInput', () => {
  it('a new row with a value but no key is held, naming the row; a blank row is not', async () => {
    const { user, held } = withProvider(<Labels initial={{ env: 'prod' }} />);
    await user.click(screen.getByRole('button', { name: t('ui.kv.add') }));
    expect(held()).toEqual([]);
    await user.type(screen.getByRole('textbox', { name: t('ui.kv.valueN', { n: 2 }) }), 'x');
    expect(held()).toEqual([t('ui.pending.noKey', { field: 'Labels', n: 2 })]);
    // Flagged, so a refused Save can take the user there.
    expect(screen.getByRole('textbox', { name: t('ui.kv.keyN', { n: 2 }) })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(t('ui.kv.noKey'))).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: t('ui.kv.keyN', { n: 2 }) }), 'team');
    expect(held()).toEqual([]);
    expect(screen.getByRole('textbox', { name: t('ui.kv.keyN', { n: 2 }) })).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('status', { name: 'map' })).toHaveTextContent('{"env":"prod","team":"x"}');
  });

  it('a key renamed into one already there is held until it is unique', async () => {
    const { user, held } = withProvider(<Labels initial={{ env: 'prod', team: 'a' }} />);
    const key2 = screen.getByRole('textbox', { name: t('ui.kv.keyN', { n: 2 }) });
    await user.clear(key2);
    // Emptied: the row keeps its value, which no key carries now.
    expect(held()).toEqual([t('ui.pending.noKey', { field: 'Labels', n: 2 })]);
    await user.type(key2, 'env');
    expect(held()).toEqual([t('ui.pending.duplicateKey', { field: 'Labels', key: 'env' })]);
    await user.type(key2, '2');
    expect(held()).toEqual([]);
    expect(screen.getByRole('status', { name: 'map' })).toHaveTextContent('{"env":"prod","env2":"a"}');
  });

  it('removing a held row lets it go', async () => {
    const { user, held } = withProvider(<Labels initial={{ env: 'prod' }} />);
    await user.click(screen.getByRole('button', { name: t('ui.kv.add') }));
    await user.type(screen.getByRole('textbox', { name: t('ui.kv.keyN', { n: 2 }) }), 'env');
    expect(held()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: t('ui.kv.remove', { n: 2 }) }));
    expect(held()).toEqual([]);
  });
});

describe('dialogs answer for their own fields', () => {
  function PortDialog({ outer }: { outer?: (entries: PendingEntry[]) => void }) {
    const [port, setPort] = useState<number | undefined>(80);
    const dialog = (
      <Dialog
        open
        onClose={() => {}}
        title="Add node"
        footer={(held) => (
          <Button variant="primary" disabled={held.length > 0}>
            Add node
          </Button>
        )}
      >
        <NumberInput label="Port" value={port} onChange={setPort} />
      </Dialog>
    );
    return outer ? <PendingProvider onChange={outer}>{dialog}</PendingProvider> : dialog;
  }

  it('a Dialog form cannot be confirmed while a field holds input; the editor around it hears nothing', async () => {
    const outer = vi.fn<(entries: PendingEntry[]) => void>();
    const user = userEvent.setup();
    render(<PortDialog outer={outer} />);
    const port = screen.getByRole('spinbutton', { name: 'Port' });
    await user.clear(port);
    await user.type(port, '-');
    expect(screen.getByRole('button', { name: 'Add node' })).toBeDisabled();
    expect(outer.mock.calls.flatMap(([entries]) => entries)).toEqual([]);
    await user.type(port, '1');
    expect(screen.getByRole('button', { name: 'Add node' })).toBeEnabled();
  });

  it("the kit gallery's Add upstream node dialog cannot be confirmed while its port shows \"-\"", async () => {
    const { default: Gallery } = await import('./Gallery');
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Gallery />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Add upstream node' }));
    const port = dialog.getByRole('spinbutton', { name: 'Port' });
    await user.clear(port);
    await user.type(port, '-');
    expect(dialog.getByRole('button', { name: 'Add node' })).toBeDisabled();
    await user.type(port, '8');
    expect(dialog.getByRole('button', { name: 'Add node' })).toBeEnabled();
  });

  it('a dialog closed while a field held input opens again with nothing held', async () => {
    function Toggle() {
      const [open, setOpen] = useState(true);
      const [n, setN] = useState<number | undefined>(1);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <ConfirmDialog open={open} title="Scale?" confirmLabel="Scale" onConfirm={() => {}} onCancel={() => setOpen(false)} body={<NumberInput label="Replicas" value={n} onChange={setN} />} />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Toggle />);
    await user.type(screen.getByRole('spinbutton', { name: 'Replicas' }), 'x');
    expect(screen.getByRole('button', { name: 'Scale' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: t('ui.cancel') }));
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('button', { name: 'Scale' })).toBeEnabled();
  });

  it('a ConfirmDialog with a field in its body cannot be confirmed while it holds input', async () => {
    const onConfirm = vi.fn();
    function Ask() {
      const [n, setN] = useState<number | undefined>(3);
      return (
        <ConfirmDialog open title="Scale?" confirmLabel="Scale" onConfirm={onConfirm} onCancel={() => {}} body={<NumberInput label="Replicas" value={n} onChange={setN} />} />
      );
    }
    const user = userEvent.setup();
    render(<Ask />);
    const field = screen.getByRole('spinbutton', { name: 'Replicas' });
    await user.clear(field);
    await user.type(field, 'x');
    const confirm = screen.getByRole('button', { name: 'Scale' });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.clear(field);
    await user.type(field, '4');
    await user.click(screen.getByRole('button', { name: 'Scale' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('NumberInput: what is emitted is what the field shows', () => {
  it('an integer a double cannot hold exactly is held (it would be saved rounded); exact ones, past 2^53 too, are emitted', async () => {
    const onChange = vi.fn<(v: number | undefined) => void>();
    function Big() {
      const [value, setValue] = useState<number | undefined>(undefined);
      return (
        <NumberInput
          label="Id"
          integer
          value={value}
          onChange={(v) => {
            onChange(v);
            setValue(v);
          }}
        />
      );
    }
    const { user, held } = withProvider(<Big />);
    const input = screen.getByRole('spinbutton', { name: 'Id' });
    await user.type(input, '12345678901234567890');
    expect(held()).toEqual([t('ui.pending.inexact', { field: 'Id', text: '12345678901234567890' })]);
    expect(onChange.mock.calls.flat().every((v) => v === undefined || Number.isSafeInteger(v))).toBe(true);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    for (const exact of ['9007199254740991', '9007199254740992', '10000000000000000000']) {
      await user.clear(input);
      await user.type(input, exact);
      expect(held()).toEqual([]);
      expect(onChange).toHaveBeenLastCalledWith(Number(exact));
    }
  });

  it('a decimal with more digits than a number holds is held; ordinary ones (1.50, 1e3, .5) are emitted', async () => {
    const onChange = vi.fn<(v: number | undefined) => void>();
    function Dec() {
      const [value, setValue] = useState<number | undefined>(undefined);
      return (
        <NumberInput
          label="Rate"
          value={value}
          onChange={(v) => {
            onChange(v);
            setValue(v);
          }}
        />
      );
    }
    const { user, held } = withProvider(<Dec />);
    const input = screen.getByRole('spinbutton', { name: 'Rate' });
    for (const [text, emitted] of [['1.50', 1.5], ['1e3', 1000], ['.5', 0.5], ['-0.25', -0.25], ['0.1', 0.1]] as const) {
      await user.clear(input);
      await user.type(input, text);
      expect(held()).toEqual([]);
      expect(onChange).toHaveBeenLastCalledWith(emitted);
    }
    await user.clear(input);
    await user.type(input, '0.30000000000000000444');
    expect(held()).toEqual([t('ui.pending.inexact', { field: 'Rate', text: '0.30000000000000000444' })]);
  });
});

describe('held input is never replaced by a value from outside', () => {
  it('NumberInput keeps "-" when its value changes from outside; Save stays held', async () => {
    function Outside() {
      const [value, setValue] = useState<number | undefined>(1);
      return (
        <>
          <NumberInput label="Send" value={value} onChange={setValue} />
          <button type="button" onClick={() => setValue(60)}>
            Fill
          </button>
        </>
      );
    }
    const { user, held } = withProvider(<Outside />);
    const input = screen.getByRole('spinbutton', { name: 'Send' });
    await user.clear(input);
    await user.type(input, '-');
    await user.click(screen.getByRole('button', { name: 'Fill' }));
    expect(input).toHaveValue('-');
    expect(held()).toEqual([t('ui.pending.notNumber', { field: 'Send', text: '-' })]);
  });

  it('KeyValueInput keeps a held row when the map changes from outside', async () => {
    function Outside() {
      const [value, setValue] = useState<Record<string, string>>({ env: 'prod' });
      return (
        <>
          <KeyValueInput label="Labels" value={value} onChange={setValue} />
          <button type="button" onClick={() => setValue({ env: 'prod', team: 'a' })}>
            Elsewhere
          </button>
        </>
      );
    }
    const { user, held } = withProvider(<Outside />);
    await user.click(screen.getByRole('button', { name: t('ui.kv.add') }));
    await user.type(screen.getByRole('textbox', { name: t('ui.kv.valueN', { n: 2 }) }), 'kept');
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.getAllByRole('textbox').map((el) => (el as HTMLInputElement).value)).toEqual(['env', 'prod', 'team', 'a', '', 'kept']);
    expect(held()).toEqual([t('ui.pending.noKey', { field: 'Labels', n: 3 })]);
  });
});

describe('a kept row is a new row', () => {
  it('a stored key emptied, kept through an outside change, then typed again: held as used twice, not stored twice', async () => {
    function Outside() {
      const [value, setValue] = useState<Record<string, string>>({ env: 'prod' });
      return (
        <>
          <KeyValueInput label="Labels" value={value} onChange={setValue} />
          <output aria-label="map">{JSON.stringify(value)}</output>
          <button type="button" onClick={() => setValue({ env: 'x' })}>
            Elsewhere
          </button>
        </>
      );
    }
    const { user, held } = withProvider(<Outside />);
    await user.clear(screen.getByRole('textbox', { name: t('ui.kv.keyN', { n: 1 }) }));
    expect(held()).toEqual([t('ui.pending.noKey', { field: 'Labels', n: 1 })]);
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.getAllByRole('textbox').map((el) => (el as HTMLInputElement).value)).toEqual(['env', 'x', '', 'prod']);
    await user.type(screen.getByRole('textbox', { name: t('ui.kv.keyN', { n: 2 }) }), 'env');
    expect(held()).toEqual([t('ui.pending.duplicateKey', { field: 'Labels', key: 'env' })]);
    expect(screen.getByRole('status', { name: 'map' })).toHaveTextContent('{"env":"x"}');
  });
});

