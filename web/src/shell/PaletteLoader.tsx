// The command palette as the shell mounts it: its code fetched on first open, inside a boundary. If
// fetching fails (a dropped connection, a deploy that removed the old chunk), or the palette throws
// while drawing, only the palette goes: it closes with a message, and the page underneath, with any
// unsaved draft, stays as it was. React.lazy keeps a failed load forever, so a failed load is
// replaced by a new one (as editor/LazyPanel.tsx does on Retry).
import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { t } from '../i18n';
import { toast } from '../ui/toast';
import type { CommandPaletteProps } from './CommandPalette';

interface BoundaryProps {
  onError: (error: Error) => void;
  children: ReactNode;
}

/** Catches what the palette throws while loading or drawing, draws nothing in its place, and reports it once. */
class PaletteBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error instanceof Error ? error : new Error(String(error)));
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The palette whose module `load` fetches, closing itself with a toast when it cannot be shown. */
export function lazyPalette(load: () => Promise<{ default: ComponentType<CommandPaletteProps> }>): ComponentType<CommandPaletteProps> {
  // A load that fails starts over at once, whether or not a palette is still mounted to see it (it
  // may have been closed while loading): a failed load is never served again.
  const start = () =>
    lazy(() =>
      load().catch((error: unknown) => {
        current = start();
        throw error;
      }),
    );
  let current = start();

  function Palette({ onClose }: CommandPaletteProps) {
    const Loaded = current;
    return (
      <PaletteBoundary
        onError={(error) => {
          toast.error(t('palette.unavailable', { error: error.message }));
          onClose('dismiss');
        }}
      >
        <Suspense fallback={null}>
          <Loaded onClose={onClose} />
        </Suspense>
      </PaletteBoundary>
    );
  }
  return Palette;
}
