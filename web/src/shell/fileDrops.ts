// A file dropped where nothing takes files (on a list, beside or on a code editor) would get the
// browser's default handling: the browser opens the file and the app, with any unsaved work, is gone
// (Task 16b, item 128). The guard decides from where the drag is, never from whether something
// cancelled it (fix round 1, F1, as ruled):
// - only places that take a dropped file are left alone: a declared drop zone (`data-file-drop`: a
//   PEM box, the proto field while unlocked, which takes a file dropped on its editor) and a file
//   input;
// - anywhere else a drag that carries files is refused, a code editor outside a drop zone included
//   (code editors take no files: Task 15 findings r1, F4): `dragover` is cancelled with no drop
//   effect, so the pointer says nothing will happen, and its `drop`, should one come, does nothing.
// A drag that carries no files (text dragged into an editor or a field) is never touched.
import { useEffect } from 'react';

/** Marks an element whose drop handlers take a dropped file themselves (they cancel the events). */
export const FILE_DROP_ZONE = { 'data-file-drop': '' } as const;

const TAKES_FILES = '[data-file-drop], input[type="file"]';

const carriesFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');
/** The element a drag is over: a Text node (as some browsers aim drag events) stands for its parent (fix round 2, M2). */
const elementOf = (target: EventTarget | null): Element | null => (target instanceof Element ? target : target instanceof Node ? target.parentElement : null);
const takesFiles = (target: EventTarget | null): boolean => elementOf(target)?.closest(TAKES_FILES) != null;

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
