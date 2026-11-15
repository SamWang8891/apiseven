// The command palette's footer: the keys that work on the active row, saying what Enter does there,
// and "/" where it opens the palette.
import { t } from '../i18n';
import type { Row } from './PaletteRow';
import { isMac } from './usePaletteHotkey';

/** What Enter does on a row: open a page or an object, show the rest of a group, apply a setting, switch connection. */
const enterOf = (row: Row | undefined): string => (row?.type === 'more' ? 'expand' : row?.type === 'action' ? row.action.enter : 'open');

/** `newTab`: the row opens a page, so Cmd/Ctrl-Enter opens it in a new tab. `slash`: "/" opens the palette on this page. */
export function PaletteHints({ row, newTab, slash }: { row: Row | undefined; newTab: boolean; slash: boolean }) {
  return (
    <div className="cp-hints" aria-hidden="true">
      <span>
        <kbd>{t('palette.key.move')}</kbd>
        {t('palette.hint.move')}
      </span>
      <span>
        <kbd>{t('palette.key.enter')}</kbd>
        {t(`palette.hint.${enterOf(row)}`)}
      </span>
      {newTab && (
        <span>
          <kbd>{t(isMac() ? 'palette.key.modEnter.mac' : 'palette.key.modEnter.other')}</kbd>
          {t('palette.hint.newTab')}
        </span>
      )}
      <span>
        <kbd>{t('palette.key.esc')}</kbd>
        {t('palette.hint.close')}
      </span>
      {slash && (
        <span>
          <kbd>{t('palette.key.slash')}</kbd>
          {t('palette.hint.slash')}
        </span>
      )}
    </div>
  );
}
