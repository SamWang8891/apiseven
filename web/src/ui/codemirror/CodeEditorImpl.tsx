// The CodeMirror 6 editor behind <CodeEditor>. Loaded lazily (see ../CodeEditor.tsx), so none of
// CodeMirror is in the initial bundle.
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, foldKeymap, indentOnInput } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorState, Transaction, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CodeEditorProps } from '../CodeEditor';
import { loadLanguage } from './languages';
import { kitTheme } from './theme';

/** Marks a document replacement that came from the `value` prop, so it is not echoed to onChange. */
const FromProps = Annotation.define<boolean>();

// Compartments are identity markers, safe to share between editor instances.
const languageSlot = new Compartment();
const readOnlySlot = new Compartment();
const labelSlot = new Compartment();
const historySlot = new Compartment();

const base: Extension = [
  lineNumbers(),
  highlightActiveLineGutter(),
  drawSelection(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  autocompletion({ icons: false }),
  highlightSelectionMatches(),
  // Tab is left to move focus (keyboard users are never trapped); Mod-[ / Mod-] indent.
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap]),
  // A dropped file is never read into the text (CodeMirror's own drop reads any file whole, with no
  // size limit, and pastes it at the drop point): the drop is stopped here and goes on to the page,
  // where a field that takes files (a proto's content, a declared drop zone) handles it with its own
  // checks. Elsewhere the window's guard refuses a file dragged over the editor, so the pointer says
  // nothing will happen (shell/fileDrops.ts), and this stays the backstop. Dropped text is still a paste.
  EditorView.domEventHandlers({
    drop: (event) => {
      if (!event.dataTransfer?.files.length) return false;
      event.preventDefault();
      return true;
    },
  }),
  kitTheme,
];

export default function CodeEditorImpl({
  value,
  onChange,
  language,
  jsonSchema,
  readOnly = false,
  'aria-label': ariaLabel,
  'aria-invalid': invalid = false,
  historyEpoch = 0,
  takeFocus,
}: CodeEditorProps & { takeFocus?: () => boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const takeFocusRef = useRef(takeFocus);

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    takeFocusRef.current = takeFocus;
  }, [onChange, takeFocus]);

  // Create the view once; the effects below configure it and keep it in step with the props.
  useLayoutEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        extensions: [
          base,
          historySlot.of(history()),
          languageSlot.of([]),
          readOnlySlot.of([]),
          labelSlot.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((tr) => tr.annotation(FromProps))) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    // The loading stand-in had focus: the editor that replaces it takes it.
    if (takeFocusRef.current?.()) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: [FromProps.of(true), Transaction.addToHistory.of(false)],
    });
  }, [value]);

  // A new history epoch: the undo history is dropped (its field taken out, then a fresh one put back),
  // so nothing typed before can be undone or redone back into the text.
  const epochSeen = useRef(historyEpoch);
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || epochSeen.current === historyEpoch) return;
    epochSeen.current = historyEpoch;
    view.dispatch({ effects: historySlot.reconfigure([]) });
    view.dispatch({ effects: historySlot.reconfigure(history()) });
  }, [historyEpoch]);

  // Language support arrives asynchronously (its own chunk); until then the text is plain.
  useEffect(() => {
    let current = true;
    loadLanguage(language, jsonSchema).then(
      (extension) => {
        if (current) viewRef.current?.dispatch({ effects: languageSlot.reconfigure(extension) });
      },
      () => {}, // a chunk that fails to load leaves a working plain-text editor
    );
    return () => {
      current = false;
    };
  }, [language, jsonSchema]);

  useLayoutEffect(() => {
    viewRef.current?.dispatch({ effects: readOnlySlot.reconfigure(readOnly ? EditorState.readOnly.of(true) : []) });
  }, [readOnly]);

  useLayoutEffect(() => {
    // In the tab order said outright (a contenteditable already is): the keyboard reaches, and so
    // scrolls, a long text, read-only ones included.
    const attributes: Record<string, string> = { tabindex: '0' };
    if (ariaLabel) attributes['aria-label'] = ariaLabel;
    if (invalid) attributes['aria-invalid'] = 'true';
    viewRef.current?.dispatch({ effects: labelSlot.reconfigure(EditorView.contentAttributes.of(attributes)) });
  }, [ariaLabel, invalid]);

  return <div ref={hostRef} className="ui-code__host" />;
}
