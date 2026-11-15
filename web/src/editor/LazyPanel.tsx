// A part of an editor fetched when first shown (a tab body, an inline form), so list pages and the
// entry bundle don't carry it. If fetching its code fails (a dropped connection, a deploy that
// removed the old chunk), only that part shows the error and a Retry: the editor around it, and
// the draft it holds, stay mounted. React.lazy keeps a failed load forever, so Retry starts a new one.
import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { t } from '../i18n';
import { Button } from '../ui';

interface BoundaryProps {
  onRetry: () => void;
  children: ReactNode;
}

/** Catches what the part below throws while loading or rendering and offers to load it again. */
class LoadBoundary extends Component<BoundaryProps, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="ed-lazy" role="alert">
        <CircleAlert size={16} aria-hidden="true" />
        <p className="ed-lazy__text">{t('editor.lazy.failed', { error: error.message })}</p>
        <Button size="sm" onClick={this.props.onRetry}>
          {t('editor.lazy.retry')}
        </Button>
      </div>
    );
  }
}

/**
 * A component whose code `load` fetches on first render (once, shared by every instance), shown
 * with `fallback` meanwhile, and with a Retry in its place when loading fails.
 */
export function lazyPanel<P extends object>(load: () => Promise<ComponentType<P>>, fallback: () => ReactNode): ComponentType<P> {
  const start = () => lazy(async () => ({ default: await load() }));
  let current = start();

  function LazyPanel(props: P) {
    // A new attempt remounts the boundary (clearing its error) around the newly started load.
    const [attempt, setAttempt] = useState(0);
    const Loaded = current;
    return (
      <LoadBoundary
        key={attempt}
        onRetry={() => {
          current = start();
          setAttempt((n) => n + 1);
        }}
      >
        {/* While it loads, the part is a busy status with a name, so assistive tech (and a test)
            can tell it is still coming. */}
        <Suspense
          fallback={
            <div role="status" aria-busy="true" aria-label={t('editor.lazy.loading')}>
              {fallback()}
            </div>
          }
        >
          <Loaded {...props} />
        </Suspense>
      </LoadBoundary>
    );
  }
  return LazyPanel;
}
