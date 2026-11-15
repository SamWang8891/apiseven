// A file dropped where nothing takes files must not reach the browser's default handling, which opens
// the file and leaves the app (Task 16b, item 128). Places that take files keep working, judged by
// where the drag is (fix round 1, F1): an editing host (a code editor, which never cancels
// `dragover`), a declared drop zone, a file input. A drag of text is left alone.
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FILE_DROP_ZONE, guardFileDrops } from './fileDrops';

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

  it('leaves a declared drop zone’s own handling alone', () => {
    undo = guardFileDrops(window);
    render(
      <div
        {...FILE_DROP_ZONE}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
      >
        <span>a drop zone</span>
      </div>,
    );
    expect(drag('dragOver', screen.getByText('a drop zone'), ['Files'])).toEqual({ prevented: true, dropEffect: 'copy' });
  });

  it('leaves an editing host alone though nothing cancelled the drag (a code editor takes the file on drop), and a file input (fix round 1, F1)', () => {
    undo = guardFileDrops(window);
    render(
      <>
        <div contentEditable suppressContentEditableWarning>
          <p>an editor line</p>
        </div>
        <input type="file" aria-label="file" />
      </>,
    );
    expect(drag('dragOver', screen.getByText('an editor line'), ['Files'])).toEqual({ prevented: false, dropEffect: 'copy' });
    expect(drag('drop', screen.getByText('an editor line'), ['Files']).prevented).toBe(false);
    expect(drag('dragOver', screen.getByLabelText('file'), ['Files'])).toEqual({ prevented: false, dropEffect: 'copy' });
  });

  it('refuses a file over an element that only cancelled the drag without declaring itself a drop zone', () => {
    undo = guardFileDrops(window);
    render(<div onDragOver={(e) => e.preventDefault()}>a list row</div>);
    expect(drag('dragOver', screen.getByText('a list row'), ['Files']).dropEffect).toBe('none');
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
