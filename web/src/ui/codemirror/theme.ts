// CodeMirror styling from the design tokens. Colours are CSS variables, so one theme serves light
// and dark: switching data-theme on <html> recolours open editors without reconfiguring them.
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

export const LINE_HEIGHT = 18;

const theme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'transparent', fontSize: '12px' },
  '&.cm-focused': { outline: 'none' }, // the .ui-code frame draws the focus ring
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: `${LINE_HEIGHT}px` },
  '.cm-content': { caretColor: 'var(--text)', padding: '6px 0' },
  '.cm-line': { padding: '0 10px 0 6px' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--accent-bg)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--text-2)', borderRight: '1px solid var(--border)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 10px', minWidth: '28px' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLineGutter': { backgroundColor: 'var(--border)', color: 'var(--text)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', color: 'var(--text-2)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-sunken)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '0 4px' },
  // Bracket pairs only while the editor has focus; otherwise the initial cursor marks the outer braces.
  '.cm-matchingBracket, .cm-nonmatchingBracket': { backgroundColor: 'transparent', outline: 'none', color: 'inherit' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-bg)', outline: '1px solid var(--accent)' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' },
  '.cm-searchMatch': { backgroundColor: 'var(--warn-bg)', outline: '1px solid var(--warn)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-bg)', outline: '1px solid var(--accent)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-bg)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger) 1px', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn) 1px', textUnderlineOffset: '3px' },
  '.cm-lint-marker': { width: '12px', height: '12px' },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-raised)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
  },
  '.cm-diagnostic': { padding: '4px 8px', borderLeft: '3px solid var(--border-strong)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--warn)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', maxHeight: '15em' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '2px 8px', lineHeight: '18px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-bg)', color: 'var(--text)' },
  '.cm-completionDetail': { color: 'var(--text-2)', fontStyle: 'normal', marginLeft: '12px' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700' },
  '.cm-completionInfo': { padding: '4px 8px', maxWidth: '320px' },
  '.cm-panels': { backgroundColor: 'var(--bg-sunken)', color: 'var(--text)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-textfield': {
    backgroundColor: 'var(--bg-raised)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius)',
  },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--bg-raised)', color: 'var(--text)', border: '1px solid var(--border-strong)' },
});

const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName), t.attributeName], color: 'var(--code-key)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape], color: 'var(--code-string)' },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.typeName, t.className], color: 'var(--code-literal)' },
  {
    tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier],
    color: 'var(--code-key)',
    fontWeight: '600',
  },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--text-2)', fontStyle: 'italic' },
  { tag: [t.meta, t.processingInstruction, t.documentMeta], color: 'var(--text-2)' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

export const kitTheme: Extension = [theme, syntaxHighlighting(highlight)];
