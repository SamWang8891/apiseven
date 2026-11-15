// The rule for a secret field in a form (Task 15, fix round 3), for a multi-line secret (SecretText),
// table-driven: (stored: none / some) × (value: none / equal / different) × (the session's flags:
// none / revealed / typed in the box) × (locked / editing / a save in flight), asserting what is shown,
// which actions exist and what each writes; then the same after a remount (the flags are lost, and
// what is shown must follow from stored and value alone).
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { MASK } from '../schema/secrets';
import { LockProvider } from '../ui';
import { SchemaForm } from './SchemaForm';

const SCHEMA = { type: 'object', properties: { private_key: { type: 'string' } } };
const STORED = 'STORED-KEY-TEXT';
const OTHER = 'OTHER-KEY-TEXT';
type Mode = 'locked' | 'editing' | 'saving';

/** A SchemaForm under the editor's kind of lock: an editing session, and `busy` while a save is in flight. */
function renderField(baseline: Obj | undefined, initial: Obj) {
  const control: { set?: (s: { mode: Mode; session: number; mount: number }) => void } = {};
  let current: Obj = initial;
  let state = { mode: 'editing' as Mode, session: 0, mount: 0 };
  function Harness() {
    const [s, setS] = useState(state);
    const [value, setValue] = useState<Obj>(initial);
    useEffect(() => {
      control.set = setS;
    }, []);
    return (
      <LockProvider locked={s.mode !== 'editing'} busy={s.mode === 'saving'} session={s.session}>
        <SchemaForm
          key={s.mount}
          schema={SCHEMA}
          value={value}
          baseline={baseline}
          onChange={(next) => {
            current = next as Obj;
            setValue(next as Obj);
          }}
        />
      </LockProvider>
    );
  }
  const result = render(<Harness />);
  const set = (next: Partial<typeof state>) =>
    act(() => {
      state = { ...state, ...next };
      control.set?.(state);
    });
  return {
    ...result,
    user: userEvent.setup(),
    value: () => current.private_key as string | undefined,
    /** A save in flight, then its refusal; or the end of the session (an accepted save: locked, new session). */
    mode: (mode: Mode) => set(mode === 'locked' ? { mode, session: state.session + 1 } : { mode }),
    remount: () => set({ mount: state.mount + 1 }),
  };
}

const button = (key: string) => screen.queryByRole('button', { name: key === 'sf.secret.keep' ? t(key) : t(key, { name: 'private_key' }) });
const ACTIONS = { Show: 'sf.secret.show', Hide: 'sf.secret.hide', Replace: 'sf.secret.replace', Keep: 'sf.secret.keep' } as const;
type ActionName = keyof typeof ACTIONS;

/** The rule, stated on its own: what the field shows and which actions it offers. */
function expected(stored: string | undefined, value: string, flags: { revealed: boolean; box?: string }, mode: Mode): { shown: string; actions: ActionName[] } {
  if (mode === 'locked') return { shown: 'masked', actions: [] };
  const acting = mode === 'editing';
  const keep: ActionName[] = stored !== undefined && (value !== stored || flags.box !== undefined) ? ['Keep'] : [];
  if (flags.box !== undefined || (flags.revealed && value !== '') || (value === '' && stored === undefined)) {
    const hide: ActionName[] = flags.revealed && flags.box === undefined ? ['Hide'] : [];
    return { shown: `box:${flags.box ?? (flags.revealed ? value : '')}`, actions: acting ? [...hide, ...keep] : [] };
  }
  const shown = value === '' ? 'removed' : value === stored ? 'stored' : 'entered';
  return { shown, actions: acting ? [...(value !== '' ? (['Show'] as ActionName[]) : []), 'Replace', ...keep] : [] };
}

function assertShown(h: ReturnType<typeof renderField>, exp: { shown: string; actions: ActionName[] }, value: string, where: string) {
  const html = h.container.innerHTML;
  const box = screen.queryByRole('textbox', { name: 'private_key' });
  if (exp.shown.startsWith('box:')) {
    const text = exp.shown.slice(4);
    if (box) expect((box as HTMLTextAreaElement).value, where).toBe(text);
    else if (text !== '') expect(screen.getByText(text), where).toBeInTheDocument();
  } else {
    expect(box, `${where}: no box`).toBeNull();
    if (value !== '') expect(html.includes(value), `${where}: the value is not on the page`).toBe(false);
    if (exp.shown === 'masked') {
      if (value !== '') expect(html.includes(MASK), `${where}: masked`).toBe(true);
    } else expect(screen.getByText(t(`sf.secret.${exp.shown}`)), where).toBeInTheDocument();
  }
  for (const name of Object.keys(ACTIONS) as ActionName[]) expect(button(ACTIONS[name]) !== null, `${where}: ${name}`).toBe(exp.actions.includes(name));
}

const STORED_CASES: (string | undefined)[] = [undefined, STORED];
const VALUES = ['none', 'equal', 'different'] as const;
const FLAGS = ['none', 'revealed', 'typed'] as const;
const MODES: Mode[] = ['editing', 'saving', 'locked'];

const cases = STORED_CASES.flatMap((stored) =>
  VALUES.filter((v) => stored !== undefined || v !== 'equal').flatMap((v) => FLAGS.flatMap((flag) => MODES.map((mode) => ({ stored, v, flag, mode })))),
);

describe('a multi-line secret field follows the rule (stored × value × flags × mode)', () => {
  it.each(cases)('stored $stored, value $v, flags $flag, $mode; then after a remount', async ({ stored, v, flag, mode }) => {
    const initialValue = v === 'none' ? '' : v === 'equal' ? (stored as string) : OTHER;
    const h = renderField(stored === undefined ? undefined : { private_key: stored }, initialValue === '' ? {} : { private_key: initialValue });
    let value = initialValue;
    const flags: { revealed: boolean; box?: string } = { revealed: false };
    // The flag, set by the user while editing.
    if (flag === 'revealed') {
      const show = button(ACTIONS.Show);
      if (show) {
        await h.user.click(show);
        flags.revealed = true;
      }
    } else if (flag === 'typed') {
      const replace = button(ACTIONS.Replace);
      if (replace) {
        await h.user.click(replace);
        // Replace: an empty box, which writes the stored value (or none).
        value = stored ?? '';
        expect(h.value() ?? '', 'Replace writes what an empty box means').toBe(value);
      }
      await h.user.type(screen.getByRole('textbox', { name: 'private_key' }), 'T');
      value = 'T';
      flags.box = 'T';
      expect(h.value()).toBe('T');
      expect(screen.getByText(stored !== undefined ? t('sf.secret.emptyStored') : t('sf.secret.emptyNone'))).toBeInTheDocument();
    }
    h.mode(mode);
    const effective = mode === 'locked' ? { revealed: false } : flags;
    assertShown(h, expected(stored, value, effective, mode), value, `${mode}`);
    if (mode === 'saving') {
      // A refused save: exactly as before Save.
      h.mode('editing');
      assertShown(h, expected(stored, value, flags, 'editing'), value, 'after a refused save');
    }
    if (mode !== 'locked') {
      // A remount in the session (a tab switch, a Form / JSON toggle, a collapse): the flags are lost.
      h.mode('editing');
      h.remount();
      assertShown(h, expected(stored, value, { revealed: false }, 'editing'), value, 'after a remount');
      // What Keep writes: the stored value; it exists only when stored exists and the value differs.
      const keep = button(ACTIONS.Keep);
      if (keep) {
        await h.user.click(keep);
        expect(h.value()).toBe(stored);
        assertShown(h, expected(stored, stored as string, { revealed: false }, 'editing'), stored as string, 'after Keep');
      }
    }
  });
});

describe('a multi-line secret field: the box', () => {
  it('typed then emptied writes the stored value (or none), and its words say which; leaving it changes nothing', async () => {
    for (const stored of [STORED, undefined]) {
      const h = renderField(stored === undefined ? undefined : { private_key: stored }, stored === undefined ? {} : { private_key: stored });
      if (stored !== undefined) await h.user.click(button(ACTIONS.Replace) as HTMLElement);
      const box = screen.getByRole('textbox', { name: 'private_key' });
      await h.user.type(box, 'NEW');
      await h.user.tab();
      expect(screen.getByRole('textbox', { name: 'private_key' })).toHaveValue('NEW');
      await h.user.clear(screen.getByRole('textbox', { name: 'private_key' }));
      expect(h.value()).toBe(stored);
      expect(screen.getByText(stored !== undefined ? t('sf.secret.emptyStored') : t('sf.secret.emptyNone'))).toBeInTheDocument();
      h.unmount();
    }
  });

  it('a refresh while locked that changes the stored value: Keep then writes the new stored value', async () => {
    // The frame refreshes `baseline` and the value together; the field reads stored from the baseline.
    const control: { set?: (v: Obj) => void } = {};
    let current: Obj = { private_key: STORED };
    function Refreshing() {
      const [stored, setStored] = useState<Obj>({ private_key: STORED });
      const [value, setValue] = useState<Obj>({ private_key: STORED });
      const [locked, setLocked] = useState(true);
      useEffect(() => {
        control.set = (next) => {
          setStored(next);
          setValue(next);
        };
      }, []);
      return (
        <>
          <button type="button" onClick={() => setLocked(false)}>
            edit
          </button>
          <LockProvider locked={locked} session={0}>
            <SchemaForm
              schema={SCHEMA}
              value={value}
              baseline={stored}
              onChange={(next) => {
                current = next as Obj;
                setValue(next as Obj);
              }}
            />
          </LockProvider>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Refreshing />);
    act(() => control.set?.({ private_key: OTHER }));
    expect(document.body.innerHTML.includes(OTHER)).toBe(false);
    await user.click(screen.getByRole('button', { name: 'edit' }));
    await user.click(button(ACTIONS.Replace) as HTMLElement);
    await user.type(screen.getByRole('textbox', { name: 'private_key' }), 'MINE');
    await user.click(button(ACTIONS.Keep) as HTMLElement);
    expect(current.private_key).toBe(OTHER);
  });
});
