// A file dropped where nothing takes files (on a list, beside an editor) would get the browser's
// default handling: the browser opens the file and the app, with any unsaved work, is gone (Task
// 16b, item 128). The guard decides from where the drag is, never from whether something cancelled
// it (fix round 1, F1: a code editor takes a dropped file without cancelling `dragover`):
// - places that take files are left alone: an editing host (every code editor's content, which
//   inserts the file's text while editable and refuses it, the page staying, while read-only), a
//   declared drop zone (`data-file-drop`: a PEM box, the proto field), a file input;
// - anywhere else a drag that carries files is refused: `dragover` is cancelled with no drop effect
//   (the pointer says it can't be dropped there), and its `drop`, should one come, does nothing.
// A drag of text is left to the browser and the fields.
import { useEffect } from 'react';

/** Marks an element whose drop handlers take a dropped file themselves (they cancel the events). */
export const FILE_DROP_ZONE = { 'data-file-drop': '' } as const;

const TAKES_FILES = '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [data-file-drop], input[type="file"]';

const carriesFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');
const takesFiles = (target: EventTarget | null): boolean => target instanceof Element && target.closest(TAKES_FILES) !== null;

/** Guards `target` (the window) against file drops where nothing takes files; returns the way to remove the guard. */
export function guardFileDrops(target: Window): () => void {
  const onDragOver = (e: DragEvent) => {
    if (!carriesFiles(e) || takesFiles(e.target)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  };
  const onDrop = (e: DragEvent) => {
    if (carriesFiles(e) && !takesFiles(e.target)) e.preventDefault();
  };
  target.addEventListener('dragover', onDragOver);
  target.addEventListener('drop', onDrop);
  return () => {
    target.removeEventListener('dragover', onDragOver);
    target.removeEventListener('drop', onDrop);
  };
}

/** The guard, for as long as the app is mounted. */
export function useFileDropGuard(): void {
  useEffect(() => guardFileDrops(window), []);
}
