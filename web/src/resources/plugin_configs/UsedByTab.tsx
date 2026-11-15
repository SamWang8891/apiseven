// The plugin config editor's "Used by" tab: the routes that name it (`plugin_config_id`: only a route
// has one, schema_def.lua 688), as a table of their own (remembered under plugin_configs.routes) whose
// rows only open the route: a table inside an editor never writes (its status is a Badge). It owns no
// fields. A plugin config not saved yet has no id to be named by, so the tab says so instead.
import { Pencil } from 'lucide-react';
import { useCallback, useId, useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { newPathFor, pathFor } from '../../router/paths';
import { DataTable } from '../../table/DataTable';
import { NewLink } from '../../table/Toolbar';
import { LockProvider } from '../../ui';
import type { TabProps } from '../registry';
import { routeColumns } from '../routes/columns';
import '../resources.css';

const idOf = (v: unknown): string | undefined => (typeof v === 'number' ? String(v) : typeof v === 'string' && v !== '' ? v : undefined);

function Routes({ configId, ctx }: { configId: string; ctx: TabProps['ctx'] }) {
  const id = useId();
  const navigate = useNavigate();
  const routes = useMemo(() => ctx.routes.filter((r) => idOf(r.value.plugin_config_id) === configId), [ctx.routes, configId]);
  const rowActions = useCallback(
    (item: Item) => [{ id: 'edit', label: t('action.edit'), icon: <Pencil size={14} />, onSelect: () => void navigate(pathFor('routes', item.id)) }],
    [navigate],
  );
  const newLink = { to: `${newPathFor('routes')}?plugin_config_id=${encodeURIComponent(configId)}`, label: t('pc.usedBy.new') };
  return (
    <section className="res-embedded" aria-labelledby={id}>
      <h2 className="res-embedded__title" id={id}>
        {t('pc.usedBy.title')}
      </h2>
      <p className="res-embedded__help">{t('pc.usedBy.help')}</p>
      {/* A list of other objects, not a field of the plugin config: its view controls work while it is locked. */}
      <LockProvider locked={false}>
        <DataTable
          kind="routes"
          items={routes}
          columns={routeColumns}
          ctx={ctx}
          rowActions={rowActions}
          stateKey="plugin_configs.routes"
          loading={!ctx.loaded.routes}
          newLink={newLink}
          emptyState={
            <div className="res-embedded__empty">
              <p className="res-embedded__none">{t('pc.usedBy.none')}</p>
              <NewLink kind="routes" to={newLink.to} label={newLink.label} />
            </div>
          }
        />
      </LockProvider>
    </section>
  );
}

export function UsedByTab({ draft, ctx, isNew, original }: TabProps) {
  const configId = isNew ? undefined : (original?.id ?? idOf(draft.id));
  if (configId === undefined) return <p className="res-callout">{t('pc.usedBy.newNote')}</p>;
  return <Routes configId={configId} ctx={ctx} />;
}
