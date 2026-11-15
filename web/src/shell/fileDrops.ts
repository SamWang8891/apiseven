// A file dropped where no drop zone takes it (beside the JSON editor, on a list) would get the
// browser's default handling: the browser opens the file and the app, with any unsaved work, is gone
// (Task 16b, item 128). Drop zones (a PEM box, the proto editor) cancel the drag events they handle;
// at the window, a drag that carries files and that nothing handled is cancelled with no drop effect
// (the pointer says it can't be dropped there), and its drop, should one come, does nothing. A drag of
// text is left to the browser and the fields.
import { useEffect } from 'react';

const carriesFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/** Guards `target` (the window) against file drops nothing handled; returns the way to remove the guard. */
export function guardFileDrops(target: Window): () => void {
  const onDragOver = (e: DragEvent) => {
    if (e.defaultPrevented || !carriesFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  };
  const onDrop = (e: DragEvent) => {
    if (!e.defaultPrevented && carriesFiles(e)) e.preventDefault();
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
