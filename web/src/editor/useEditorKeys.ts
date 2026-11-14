import { useEffect, useLayoutEffect, useRef } from 'react';

/** Where a typed `e` is text, not the shortcut: fields, CodeMirror, anything contenteditable. */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .cm-editor';
/** Open overlays own the keyboard: a dialog, a menu (typeahead), a listbox. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const inside = (target: EventTarget | null, selector: string): boolean => target instanceof Element && target.closest(selector) !== null;

export interface EditorKeys {
  locked: boolean;
  /** False with a read-only key: `e` does nothing then. */
  canEdit: boolean;
  onEdit: () => void;
  onSave: () => void;
}

/**
 * The editor's shortcuts, on the whole window: `e` unlocks (not while typing in a field, not with a
 * modifier, not inside an overlay); Cmd/Ctrl+S saves when unlocked and never opens the browser's
 * "save page" dialog on an editor page.
 */
export function useEditorKeys(keys: EditorKeys): void {
  const latest = useRef(keys);
  useLayoutEffect(() => {
    latest.current = keys;
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const { locked, canEdit, onEdit, onSave } = latest.current;
      const key = e.key.toLowerCase();
      if (key === 's' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (!locked && !inside(e.target, OVERLAY)) onSave();
        return;
      }
      if (key !== 'e' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || e.isComposing) return;
      if (!locked || !canEdit || inside(e.target, TYPING) || inside(e.target, OVERLAY)) return;
      e.preventDefault();
      onEdit();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
