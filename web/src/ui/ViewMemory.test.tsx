// The page's view memory (ui/ViewMemory.tsx): what is set comes back after a remount; what was only
// an initial value is worked out afresh; it is written from the commit (fix round 1, R3.6).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useViewState, ViewMemory } from './ViewMemory';

function Counter({ id, start }: { id: string; start: number }) {
  const [n, setN] = useViewState(id, start);
  return (
    <button type="button" onClick={() => setN((v) => v + 1)}>
      {id} {n}
    </button>
  );
}

function Page({ start }: { start: number }) {
  const [shown, setShown] = useState(true);
  return (
    <ViewMemory>
      <button type="button" onClick={() => setShown((s) => !s)}>
        toggle
      </button>
      {shown && (
        <>
          <Counter id="a" start={start} />
          <Counter id="b" start={start} />
        </>
      )}
    </ViewMemory>
  );
}

describe('useViewState', () => {
  it('a value set comes back after a remount; one never set starts from its initial value again', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Page start={0} />);
    await user.click(screen.getByRole('button', { name: 'a 0' }));
    expect(screen.getByRole('button', { name: 'a 1' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'toggle' }));
    rerender(<Page start={5} />);
    await user.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByRole('button', { name: 'a 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'b 5' })).toBeInTheDocument();
  });

  // Fix round 2, F2: a new key starts over (from the memory for that key, else the initial value); the old value is not carried to it.
  it('when its key changes, the state starts over and nothing is written under the new key', async () => {
    const user = userEvent.setup();
    function Keyed({ id }: { id: string }) {
      const [n, setN] = useViewState(id, 0);
      return (
        <button type="button" onClick={() => setN((v) => v + 1)}>
          {id} {n}
        </button>
      );
    }
    const { rerender } = render(
      <ViewMemory>
        <Keyed id="s1" />
      </ViewMemory>,
    );
    await user.click(screen.getByRole('button', { name: 's1 0' }));
    rerender(
      <ViewMemory>
        <Keyed id="s2" />
      </ViewMemory>,
    );
    expect(screen.getByRole('button', { name: 's2 0' })).toBeInTheDocument();
    rerender(
      <ViewMemory>
        <Keyed id="s1" />
      </ViewMemory>,
    );
    expect(screen.getByRole('button', { name: 's1 1' })).toBeInTheDocument();
  });
});
