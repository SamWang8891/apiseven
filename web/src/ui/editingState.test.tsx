// State that belongs to an editing session (useEditingState) and revealed secrets (useReveal): what
// ends when the field locks, so nothing of it shows in the locked view or comes back on the next Edit.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { Input, LockProvider, useEditingState } from './index';

function Typed() {
  const [text, setText] = useEditingState('');
  return <input aria-label="typed" value={text} onChange={(e) => setText(e.target.value)} />;
}

describe('useEditingState', () => {
  it('under a provider with a session: kept through a lock in the same session, started over when the session changes', async () => {
    const user = userEvent.setup();
    const tree = (locked: boolean, session: number) => (
      <LockProvider locked={locked} session={session}>
        <Typed />
      </LockProvider>
    );
    const { rerender } = render(tree(false, 0));
    await user.type(screen.getByRole('textbox', { name: 'typed' }), 'abc');
    // A save in flight locks without ending the session.
    rerender(tree(true, 0));
    rerender(tree(false, 0));
    expect(screen.getByRole('textbox', { name: 'typed' })).toHaveValue('abc');
    // Save (or Discard) ends it.
    rerender(tree(true, 1));
    rerender(tree(false, 1));
    expect(screen.getByRole('textbox', { name: 'typed' })).toHaveValue('');
  });

  it('under a provider without a session: started over whenever it locks', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <LockProvider locked={false}>
        <Typed />
      </LockProvider>,
    );
    await user.type(screen.getByRole('textbox', { name: 'typed' }), 'abc');
    rerender(
      <LockProvider locked>
        <Typed />
      </LockProvider>,
    );
    rerender(
      <LockProvider locked={false}>
        <Typed />
      </LockProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'typed' })).toHaveValue('');
  });
});

describe('a revealed secret', () => {
  function Secret({ locked, session }: { locked: boolean; session: number }) {
    const [value, setValue] = useState('s3cret-value');
    return (
      <LockProvider locked={locked} session={session}>
        <Input label="Key" secret value={value} onChange={(e) => setValue(e.target.value)} />
      </LockProvider>
    );
  }

  it('is masked again as soon as the field locks, a save in flight included, and stays masked on the next Edit', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Secret locked={false} session={0} />);
    await user.click(screen.getByRole('button', { name: t('ui.secret.show') }));
    expect(screen.getByLabelText('Key')).toHaveAttribute('type', 'text');
    rerender(<Secret locked session={0} />);
    expect(screen.queryByText('s3cret-value')).not.toBeInTheDocument();
    rerender(<Secret locked session={1} />);
    expect(screen.queryByText('s3cret-value')).not.toBeInTheDocument();
    rerender(<Secret locked={false} session={1} />);
    expect(screen.getByLabelText('Key')).toHaveAttribute('type', 'password');
  });
});
