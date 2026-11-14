import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PendingProvider, usePending, type PendingEntry } from './PendingContext';

function Holder({ message }: { message: string | undefined }) {
  usePending(message);
  return null;
}

describe('usePending', () => {
  it('registers, updates and unregisters with the nearest provider', () => {
    const onChange = vi.fn<(entries: PendingEntry[]) => void>();
    const tree = (a: string | undefined, b: string | undefined, showB = true) => (
      <PendingProvider onChange={onChange}>
        <Holder message={a} />
        {showB && <Holder message={b} />}
      </PendingProvider>
    );
    const { rerender, unmount } = render(tree(undefined, undefined));
    const last = () => (onChange.mock.calls.at(-1)?.[0] ?? []).map((e) => e.message);
    expect(last()).toEqual([]);

    rerender(tree('Node 2: "a:80" is already in the list', undefined));
    expect(last()).toEqual(['Node 2: "a:80" is already in the list']);
    rerender(tree('Node 2: "a:80" is already in the list', 'Port: "8o" is not a number'));
    expect(last()).toEqual(['Node 2: "a:80" is already in the list', 'Port: "8o" is not a number']);
    // A changed message replaces the entry; the ids are stable.
    const ids = onChange.mock.calls.at(-1)?.[0].map((e) => e.id);
    rerender(tree('Node 2: "b:80" is already in the list', 'Port: "8o" is not a number'));
    expect(last()).toEqual(['Node 2: "b:80" is already in the list', 'Port: "8o" is not a number']);
    expect(onChange.mock.calls.at(-1)?.[0].map((e) => e.id)).toEqual(ids);

    rerender(tree(undefined, 'Port: "8o" is not a number'));
    expect(last()).toEqual(['Port: "8o" is not a number']);
    rerender(tree(undefined, 'Port: "8o" is not a number', false));
    expect(last()).toEqual([]);
    const calls = onChange.mock.calls.length;
    unmount();
    expect(onChange.mock.calls.length).toBe(calls);
  });

  it('does not report an unchanged message again', () => {
    const onChange = vi.fn<(entries: PendingEntry[]) => void>();
    const { rerender } = render(
      <PendingProvider onChange={onChange}>
        <Holder message="x" />
      </PendingProvider>,
    );
    const calls = onChange.mock.calls.length;
    rerender(
      <PendingProvider onChange={onChange}>
        <Holder message="x" />
      </PendingProvider>,
    );
    expect(onChange.mock.calls.length).toBe(calls);
  });

  it('reports what is held from the start', () => {
    const onChange = vi.fn<(entries: PendingEntry[]) => void>();
    render(
      <PendingProvider onChange={onChange}>
        <Holder message="held at mount" />
      </PendingProvider>,
    );
    expect(onChange.mock.calls.at(-1)?.[0].map((e) => e.message)).toEqual(['held at mount']);
  });

  it('is a no-op without a provider', () => {
    expect(() => render(<Holder message="held" />)).not.toThrow();
  });
});
