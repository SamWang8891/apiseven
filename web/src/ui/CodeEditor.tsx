import { lazy, Suspense, useRef, type CSSProperties } from 'react';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { useLocked } from './LockContext';
import './code.css';

export interface CodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  language: 'json' | 'yaml' | 'lua' | 'pem' | 'proto' | 'text';
  /** For 'json': lint against this schema and complete its property names and enum values. */
  jsonSchema?: Obj;
  /** Selectable and copyable, not editable. Also implied by a locked LockProvider. */
  readOnly?: boolean;
  /** Height bounds in lines; it grows with the text between them, then scrolls. Default 4 and 30. */
  minLines?: number;
  maxLines?: number;
  'aria-label'?: string;
  /** The text is not accepted (it doesn't parse): marked for assistive tech, and found by a refused Save. */
  'aria-invalid'?: boolean;
  /**
   * Each change empties the undo history (what undo and redo could bring back), the text staying as it
   * is: a JSON view drops it once a private key that was typed or pasted has left the page.
   */
  historyEpoch?: number;
}
// A file dropped on the editor is never read into its text (codemirror/CodeEditorImpl.tsx): the drop
// event goes on to the page, so a field that takes files listens around the editor.

// CodeMirror is fetched on first use; until then the text shows as a plain block of the same size.
const CodeEditorImpl = lazy(() => import('./codemirror/CodeEditorImpl'));

export function CodeEditor(props: CodeEditorProps) {
  const locked = useLocked();
  // Whether the stand-in had focus when CodeMirror arrived: then the editor takes it, not <body>.
  const fallbackFocused = useRef(false);
  const readOnly = locked || props.readOnly === true;
  const { minLines = 4, maxLines = 30 } = props;
  const size = { '--code-min-lines': minLines, '--code-max-lines': Math.max(minLines, maxLines) } as CSSProperties;
  return (
    <div className={readOnly ? 'ui-code ui-code--readonly' : 'ui-code'} style={size}>
      <Suspense
        fallback={
          <pre
            className="ui-code__fallback"
            tabIndex={0}
            aria-label={props['aria-label']}
            aria-busy="true"
            title={t('ui.code.loading')}
            onFocus={() => (fallbackFocused.current = true)}
            onBlur={() => (fallbackFocused.current = false)}
          >
            {props.value}
          </pre>
        }
      >
        <CodeEditorImpl
          {...props}
          readOnly={readOnly}
          takeFocus={() => {
            const had = fallbackFocused.current;
            fallbackFocused.current = false;
            return had;
          }}
        />
      </Suspense>
    </div>
  );
}
