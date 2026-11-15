// A file dropped where no drop zone takes it must not reach the browser's default handling, which opens
// the file and leaves the app (Task 16b, item 128). Drop zones keep working: they cancel the events
// they handle themselves, and the window leaves those alone; so does a drag of text.
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { guardFileDrops } from './fileDrops';

let undo: (() => void) | undefined;
afterEach(() => {
  undo?.();
  undo = undefined;
});

/** A drag event as the browser fires it, with what it carries. */
function drag(type: 'dragOver' | 'drop', target: Element, types: string[]) {
  const event = createEvent[type](target, { dataTransfer: { types, dropEffect: 'copy' } });
  fireEvent(target, event);
  return { prevented: event.defaultPrevented, dropEffect: (event as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect };
}

describe('the window-level guard for dropped files', () => {
  it('refuses a file dragged over, and dropped on, a place that takes none', () => {
    undo = guardFileDrops(window);
    render(<p>beside the JSON editor</p>);
    const spot = screen.getByText('beside the JSON editor');
    expect(drag('dragOver', spot, ['Files'])).toEqual({ prevented: true, dropEffect: 'none' });
    expect(drag('drop', spot, ['Files']).prevented).toBe(true);
  });

  it('leaves a drop zone’s own handling alone', () => {
    undo = guardFileDrops(window);
    render(
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
      >
        a drop zone
      </div>,
    );
    expect(drag('dragOver', screen.getByText('a drop zone'), ['Files'])).toEqual({ prevented: true, dropEffect: 'copy' });
  });

  it('leaves dragged text alone (a text field takes it as the browser does)', () => {
    undo = guardFileDrops(window);
    render(<p>text</p>);
    expect(drag('dragOver', screen.getByText('text'), ['text/plain'])).toEqual({ prevented: false, dropEffect: 'copy' });
    expect(drag('drop', screen.getByText('text'), ['text/plain']).prevented).toBe(false);
  });

  it('is gone once removed', () => {
    guardFileDrops(window)();
    render(<p>after</p>);
    expect(drag('dragOver', screen.getByText('after'), ['Files']).prevented).toBe(false);
  });
});
