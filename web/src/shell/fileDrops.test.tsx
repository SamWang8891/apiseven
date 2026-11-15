// A file dropped where nothing takes files must not reach the browser's default handling, which opens
// the file and leaves the app (Task 16b, item 128). Judged by where the drag is (fix round 1, F1, as
// ruled): only a declared drop zone and a file input take files; a code editor outside a drop zone
// takes none (Task 15 findings r1, F4), so a file over it is refused like anywhere else. A drag that
// carries no files is never touched.
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

  it('refuses a file over a code editor outside a drop zone (an editing host); a text drag over it is untouched; a file input is left alone (fix round 1, F1)', () => {
    undo = guardFileDrops(window);
    render(
      <>
        <div contentEditable suppressContentEditableWarning>
          <p>an editor line</p>
        </div>
        <input type="file" aria-label="file" />
      </>,
    );
    expect(drag('dragOver', screen.getByText('an editor line'), ['Files'])).toEqual({ prevented: true, dropEffect: 'none' });
    expect(drag('drop', screen.getByText('an editor line'), ['Files']).prevented).toBe(true);
    expect(drag('dragOver', screen.getByText('an editor line'), ['text/plain'])).toEqual({ prevented: false, dropEffect: 'copy' });
    expect(drag('drop', screen.getByText('an editor line'), ['text/plain']).prevented).toBe(false);
    expect(drag('dragOver', screen.getByLabelText('file'), ['Files'])).toEqual({ prevented: false, dropEffect: 'copy' });
  });

  it('leaves a code editor inside a declared drop zone to the zone (the proto field)', () => {
    undo = guardFileDrops(window);
    render(
      <div
        {...FILE_DROP_ZONE}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
      >
        <div contentEditable suppressContentEditableWarning>
          <p>proto source</p>
        </div>
      </div>,
    );
    expect(drag('dragOver', screen.getByText('proto source'), ['Files'])).toEqual({ prevented: true, dropEffect: 'copy' });
  });

  it('a drag aimed at a Text node inside a declared zone is the zone’s (fix round 2, M2)', () => {
    undo = guardFileDrops(window);
    render(
      <div
        {...FILE_DROP_ZONE}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
      >
        <span>a label</span>
      </div>,
    );
    const text = screen.getByText('a label').firstChild as Text;
    expect(text.nodeType).toBe(Node.TEXT_NODE);
    const event = createEvent.dragOver(text, { dataTransfer: { types: ['Files'], dropEffect: 'copy' } });
    fireEvent(text, event);
    expect((event as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('copy');
    // Outside a zone, a Text node is refused like its element.
    render(<p>plain text</p>);
    const plain = screen.getByText('plain text').firstChild as Text;
    const refused = createEvent.dragOver(plain, { dataTransfer: { types: ['Files'], dropEffect: 'copy' } });
    fireEvent(plain, refused);
    expect(refused.defaultPrevented).toBe(true);
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
