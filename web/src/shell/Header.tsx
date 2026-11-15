import { Check, ChevronDown, LogOut, Monitor, Moon, Plus, Search, Server, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { usePing } from '../api/hooks';
import { needsKey, useConnections, type SavedConnection } from '../connection/store';
import { hostOf } from '../connection/url';
import { t } from '../i18n';
import { kindFromSegment, pathFor } from '../router/paths';
import { Button, Menu, Tooltip, type MenuItem } from '../ui';
import { useTheme, type ThemeChoice } from './theme';
import { isMac } from './usePaletteHotkey';

export interface HeaderProps {
  /** Where the user is: the page title or a breadcrumb. */
  title?: ReactNode;
  /** Global search: the command palette's button (SearchTrigger). */
  search?: ReactNode;
}

export function Header({ title, search }: HeaderProps) {
  return (
    <header className="shell-header">
      <div className="shell-header__title">{title}</div>
      <div className="shell-header__tools">
        {search}
        <Version />
        <ConnectionSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
}

/**
 * Opens the command palette: a button styled as a search field, with the shortcut. Below 1180px wide
 * it keeps only the icon and the shortcut.
 */
export function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  const mac = isMac();
  return (
    <button
      type="button"
      className="shell-search"
      aria-label={t('palette.open')}
      aria-haspopup="dialog"
      aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
      onClick={onOpen}
    >
      <Search className="shell-search__icon" size={14} aria-hidden="true" />
      <span className="shell-search__label">{t('palette.trigger')}</span>
      <kbd className="shell-search__key">{t(mac ? 'palette.shortcut.mac' : 'palette.shortcut.other')}</kbd>
    </button>
  );
}

function Version() {
  const version = usePing().data?.version;
  return <span className="shell-version mono">{t('header.version', { version: version ?? t('ui.empty') })}</span>;
}

function ConnectionSwitcher() {
  const { list, active, setActive, disconnect, serverManaged, keyRequired } = useConnections();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (!active) return null;

  if (serverManaged) {
    return (
      <span className="shell-conn shell-conn--static">
        <Tooltip content={t('header.serverManaged')}>
          <span className="shell-conn__label" tabIndex={0}>
            <Server aria-hidden="true" size={14} />
            <span className="mono">{location.host}</span>
          </span>
        </Tooltip>
        {keyRequired && (
          <Button
            variant="ghost"
            size="sm"
            icon={<LogOut size={14} />}
            aria-label={t('header.disconnect')}
            onClick={() => {
              disconnect();
              void navigate('/connect');
            }}
          />
        )}
      </span>
    );
  }

  // Switching keeps the kind of page the user is on, as its list (an object ID means nothing elsewhere).
  const listPath = pathFor(kindFromSegment(pathname.split('/')[1]) ?? 'routes');
  const label = (c: SavedConnection) => (c.name === hostOf(c.baseUrl) ? c.name : `${c.name} (${hostOf(c.baseUrl)})`);
  const items: MenuItem[] = [
    ...list.map(
      (c): MenuItem => ({
        id: c.id,
        label: label(c),
        icon: c.id === active.id ? <Check size={14} /> : undefined,
        onSelect: () => {
          if (c.id === active.id) return;
          setActive(c.id);
          // A connection without its key lands on Connect through the shell's guard.
          if (!needsKey(c)) void navigate(listPath);
        },
      }),
    ),
    { separator: true },
    { id: 'add', label: t('header.addConnection'), icon: <Plus size={14} />, onSelect: () => void navigate('/connect') },
    {
      id: 'disconnect',
      label: t('header.disconnect'),
      icon: <LogOut size={14} />,
      onSelect: () => {
        disconnect();
        void navigate('/connect');
      },
    },
  ];

  const host = hostOf(active.baseUrl);
  return (
    <Menu
      items={items}
      trigger={
        <Button variant="ghost" className="shell-conn" aria-label={t('header.connection', { name: active.name, host })}>
          <span className="shell-conn__name">{active.name}</span>
          {active.name !== host && <span className="shell-conn__host mono">{host}</span>}
          <ChevronDown className="shell-conn__chevron" aria-hidden="true" size={14} />
        </Button>
      }
    />
  );
}

const THEMES: { value: ThemeChoice; icon: ReactNode }[] = [
  { value: 'light', icon: <Sun size={14} /> },
  { value: 'dark', icon: <Moon size={14} /> },
  { value: 'system', icon: <Monitor size={14} /> },
];

function ThemeToggle() {
  const [choice, setChoice] = useTheme();
  return (
    <div className="shell-theme" role="group" aria-label={t('theme.label')}>
      {/* Icon-only kit buttons: each shows its label as a tooltip. */}
      {THEMES.map(({ value, icon }) => (
        <Button
          key={value}
          variant="ghost"
          size="sm"
          icon={icon}
          aria-label={t(`theme.${value}`)}
          aria-pressed={choice === value}
          className="shell-theme__option"
          onClick={() => setChoice(value)}
        />
      ))}
    </div>
  );
}
