import { lazy, Suspense, useEffect, useState } from 'react';
import { t } from './i18n';

// The UI kit showcase, in development builds only (the import is dropped from production bundles).
const Gallery = import.meta.env.DEV ? lazy(() => import('./ui/Gallery')) : null;
const GALLERY_HASH = '#/__kit';

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHash();
  if (Gallery && hash === GALLERY_HASH) {
    return (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    );
  }
  return <h1>{t('app.name')}</h1>;
}
