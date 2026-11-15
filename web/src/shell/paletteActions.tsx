// The command palette's actions: go to a list, create an object, switch connection, pick a theme.
// None writes to APISIX: they navigate (through the router, so an editor's leave guard asks first),
// switch the active connection after such a navigation, or set the theme.
import { ArrowRight, Monitor, Moon, Plus, Server, Settings2, Sun } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { Kind } from '../api/types';
import { useReadOnlyKey } from '../api/write';
import { useConnections, type SavedConnection } from '../connection/store';
import { hostOf } from '../connection/url';
import { t } from '../i18n';
import { kindFromSegment, newPathFor, pathFor } from '../router/paths';
import type { Action } from './search';
import { useTheme, type ThemeChoice } from './theme';
import { switchState } from './usePalette';

export type ActionGroup = 'goTo' | 'create' | 'connections' | 'theme';

export interface PaletteAction extends Action {
  group: ActionGroup;
  icon: ReactNode;
  /** The page it opens (a hash-route path), when it only navigates: Cmd/Ctrl-Enter opens it in a new tab. */
  href?: string;
  /** What Enter does, for the footer's hint: open a page, apply a setting, switch connection. */
  enter: 'open' | 'apply' | 'switch';
}

/** How an action leaves the palette: navigating (the page it opens takes focus), or staying (focus goes back). */
export interface ActionHost {
  go(to: string, state?: unknown): void;
  dismiss(): void;
}

const THEMES: { value: ThemeChoice; icon: ReactNode }[] = [
  { value: 'light', icon: <Sun size={15} /> },
  { value: 'dark', icon: <Moon size={15} /> },
  { value: 'system', icon: <Monitor size={15} /> },
];

/** A connection as the header's switcher names it: its name, and its host when that differs. */
const connectionLabel = (c: SavedConnection): string => (c.name === hostOf(c.baseUrl) ? c.name : `${c.name} (${hostOf(c.baseUrl)})`);

/**
 * Every action, in the order shown on an empty query: Go to each list, New for each kind (none while
 * the key is read-only), switching to each other saved connection and Manage connections (none in
 * server-managed mode), the three themes. `kinds` are the kinds this APISIX has (or may have).
 */
export function usePaletteActions(kinds: Kind[], host: ActionHost): PaletteAction[] {
  const readOnly = useReadOnlyKey();
  const { list, active, serverManaged } = useConnections();
  const [, setTheme] = useTheme();
  const { pathname } = useLocation();
  // As the header's switcher: the same kind of page, as its list (an object id means nothing elsewhere).
  // The switch itself happens once that navigation is through (usePalette), so an editor's leave guard asks first.
  const listPath = pathFor(kindFromSegment(pathname.split('/')[1]) ?? 'routes');
  // Built again only when what they depend on changes, so the rows that show them keep their identity.
  return useMemo(() => buildActions({ kinds, host, readOnly, list, active, serverManaged, listPath, setTheme }), [kinds, host, readOnly, list, active, serverManaged, listPath, setTheme]);
}

interface ActionInputs {
  kinds: Kind[];
  host: ActionHost;
  readOnly: boolean;
  list: SavedConnection[];
  active?: SavedConnection;
  serverManaged: boolean;
  listPath: string;
  setTheme: (choice: ThemeChoice) => void;
}

function buildActions({ kinds, host, readOnly, list, active, serverManaged, listPath, setTheme }: ActionInputs): PaletteAction[] {
  const goTo = kinds.map((kind): PaletteAction => {
    const href = pathFor(kind);
    return {
      id: `go:${kind}`,
      group: 'goTo',
      enter: 'open',
      label: t('palette.action.goTo', { plural: t(`kind.${kind}.plural`) }),
      keywords: t('palette.keywords.goTo'),
      icon: <ArrowRight size={15} />,
      href,
      run: () => host.go(href),
    };
  });

  const create = readOnly
    ? []
    : kinds.map((kind): PaletteAction => {
        const href = newPathFor(kind);
        return {
          id: `new:${kind}`,
          group: 'create',
          enter: 'open',
          label: t('page.new', { kind: t(`kind.${kind}.singular`) }),
          keywords: t('palette.keywords.new'),
          icon: <Plus size={15} />,
          href,
          run: () => host.go(href),
        };
      });

  const connections = serverManaged
    ? []
    : [
        ...list
          .filter((c) => c.id !== active?.id)
          .map(
            (c): PaletteAction => ({
              id: `conn:${c.id}`,
              group: 'connections',
              enter: 'switch',
              label: t('palette.action.switch', { name: connectionLabel(c) }),
              keywords: `${t('palette.keywords.switch')} ${hostOf(c.baseUrl)}`,
              icon: <Server size={15} />,
              run: () => host.go(listPath, switchState(c.id)),
            }),
          ),
        {
          id: 'conn:manage',
          group: 'connections',
          enter: 'open',
          label: t('palette.action.manage'),
          keywords: t('palette.keywords.manage'),
          icon: <Settings2 size={15} />,
          href: '/connect',
          run: () => host.go('/connect'),
        } satisfies PaletteAction,
      ];

  const themes = THEMES.map(
    ({ value, icon }): PaletteAction => ({
      id: `theme:${value}`,
      group: 'theme',
      enter: 'apply',
      label: t('palette.action.theme', { theme: t(`theme.${value}`) }),
      keywords: t('palette.keywords.theme'),
      icon,
      run: () => {
        setTheme(value);
        host.dismiss();
      },
    }),
  );

  return [...goTo, ...create, ...connections, ...themes];
}
