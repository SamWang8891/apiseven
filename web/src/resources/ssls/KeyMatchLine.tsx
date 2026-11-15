// The one line under a pair's key box (Task 16 B20; keyMatch.ts): whether the key belongs to the
// certificate. A mismatch is a warning in words; a match, or a pair that could not be compared, a
// quiet line; with nothing to say (no pair yet, a reference, no WebCrypto, not known yet) the line
// says what APISIX does about it, as it did before the check. It never disables anything.
import { t } from '../../i18n';
import type { Verdict } from './keyMatch';

const QUIET: Record<Exclude<Verdict, 'mismatch'> | 'none', string> = {
  match: 'ssl.pair.matches',
  unknown: 'ssl.pair.cannotCompare',
  none: 'ssl.pair.unchecked',
};

export function KeyMatchLine({ verdict }: { verdict: Verdict | undefined }) {
  return (
    <div className="ssl-match" aria-live="polite">
      {verdict === 'mismatch' ? (
        <p className="ssl-warn" role="note">
          {t('ssl.pair.mismatch')}
        </p>
      ) : (
        <p className="ed-note">{t(QUIET[verdict ?? 'none'])}</p>
      )}
    </div>
  );
}
