import { lazy, Suspense, type CSSProperties } from 'react';
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
}

// CodeMirror is fetched on first use; until then the text shows as a plain block of the same size.
const CodeEditorImpl = lazy(() => import('./codemirror/CodeEditorImpl'));

export function CodeEditor(props: CodeEditorProps) {
  const locked = useLocked();
  const readOnly = locked || props.readOnly === true;
  const { minLines = 4, maxLines = 30 } = props;
  const size = { '--code-min-lines': minLines, '--code-max-lines': Math.max(minLines, maxLines) } as CSSProperties;
  return (
    <div className={readOnly ? 'ui-code ui-code--readonly' : 'ui-code'} style={size}>
      <Suspense
        fallback={
          <pre className="ui-code__fallback" aria-label={props['aria-label']} aria-busy="true" title={t('ui.code.loading')}>
            {props.value}
          </pre>
        }
      >
        <CodeEditorImpl {...props} readOnly={readOnly} />
      </Suspense>
    </div>
  );
}
