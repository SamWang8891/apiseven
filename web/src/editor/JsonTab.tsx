// The frame's JSON tab: the whole draft as text. It is every resource's full editor until a kind has
// form tabs, and stays the place where fields no form models are seen and changed.
import { Copy, WandSparkles } from 'lucide-react';
import { use, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { t } from '../i18n';
import { registry, type TabProps } from '../resources/registry';
import { Button, CodeEditor, toast, useLocked } from '../ui';
import { JsonErrorContext, parse, pretty, represents } from './json';

const LINE = 18;
/** Room kept under the editor: its frame, and the page's bottom padding. */
const BELOW = 44;
const MIN_LINES = 12;

/** As many lines as fit between the editor's top and the bottom of the window (at least MIN_LINES). */
function useFitLines(ref: RefObject<HTMLElement | null>): number {
  const [lines, setLines] = useState(30);
  useLayoutEffect(() => {
    const measure = () => {
      const top = ref.current?.getBoundingClientRect().top ?? 0;
      setLines(Math.max(MIN_LINES, Math.floor((window.innerHeight - top - BELOW) / LINE)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref]);
  return lines;
}

/**
 * A CodeMirror editor over JSON.stringify(draft). Every edit that parses to an object becomes the
 * draft; text that doesn't parse stays as typed, with the parser's message, and blocks Save. When
 * the draft changes from elsewhere (a form tab, Discard) the text follows. Locked: read-only, still
 * selectable and copyable. `issues` (those no form tab owns) are listed under it.
 */
export function JsonTab({ draft, setDraft, kind, issues }: TabProps) {
  const locked = useLocked();
  const report = use(JsonErrorContext);
  const hostRef = useRef<HTMLDivElement>(null);
  const maxLines = useFitLines(hostRef);
  const [state, setState] = useState(() => ({ text: pretty(draft), synced: draft, error: undefined as string | undefined }));

  let current = state;
  if (draft !== state.synced) {
    current = represents(state.text, draft) ? { ...state, synced: draft } : { text: pretty(draft), synced: draft, error: undefined };
    setState(current);
  }

  useEffect(() => report?.(current.error), [report, current.error]);
  useEffect(() => () => report?.(undefined), [report]);

  function change(text: string) {
    const parsed = parse(text);
    if (parsed.ok) {
      setState({ text, synced: parsed.value, error: undefined });
      setDraft(parsed.value);
    } else {
      setState((s) => ({ ...s, text, error: parsed.error }));
    }
  }

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(current.text);
      toast.success(t('json.copied'));
    } catch (err) {
      toast.error(t('json.copyFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  }

  const singular = registry[kind].singular;
  const formatted = current.error === undefined && current.text === pretty(draft);
  return (
    <div className="ed-json">
      <div className="ed-json__bar">
        <p className="ed-json__hint">{t('editor.json.hint', { kind: singular })}</p>
        <div className="ed-json__tools">
          {!locked && (
            <Button size="sm" variant="ghost" icon={<WandSparkles size={13} />} disabled={formatted || current.error !== undefined} onClick={() => change(pretty(draft))}>
              {t('editor.json.format')}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copy()}>
            {t('json.copy')}
          </Button>
        </div>
      </div>
      <div ref={hostRef}>
        <CodeEditor
          value={current.text}
          onChange={change}
          language="json"
          minLines={Math.min(MIN_LINES, maxLines)}
          maxLines={maxLines}
          aria-label={t('editor.json.label', { kind: singular })}
        />
      </div>
      <div aria-live="polite">{current.error !== undefined && <p className="ed-json__error mono">{current.error}</p>}</div>
      {issues.length > 0 && (
        <section className="ed-issues" aria-label={t('editor.issues')}>
          <h3 className="ed-issues__title">{t('editor.issues')}</h3>
          <ul className="ed-issues__list">
            {issues.map((issue, i) => (
              <li key={i} className="ed-issues__item">
                {issue.path !== '' && <code className="ed-issues__path mono">{issue.path}</code>}
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
