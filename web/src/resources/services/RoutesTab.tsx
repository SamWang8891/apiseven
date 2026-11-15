// The service editor's Routes tab: the routes and stream routes that use this service, each list a
// table of its own (sortable, with its own columns, remembered under services.routes and
// services.stream_routes), and a link to create one in the service (the create page reads
// `?service_id=`). It edits nothing of the service: it owns no fields. A service not saved yet has
// no id to be used by, so the tab says so instead.
import { Pencil } from 'lucide-react';
import { useCallback, useId, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useSupports } from '../../api/hooks';
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { newPathFor, pathFor } from '../../router/paths';
import { DataTable } from '../../table/DataTable';
import { NewLink } from '../../table/Toolbar';
import { LockProvider } from '../../ui';
import type { ColumnDef, TabProps } from '../registry';
import { routeColumns } from '../routes/columns';
import { streamRouteColumns } from '../stream_routes/columns';
import '../resources.css';

const idOf = (v: unknown): string | undefined => (typeof v === 'number' ? String(v) : typeof v === 'string' && v !== '' ? v : undefined);

type UserKind = 'routes' | 'stream_routes';

function Users({ kind, items, columns, loading, serviceId, ctx }: { kind: UserKind; items: Item[]; columns: ColumnDef[]; loading: boolean; serviceId: string; ctx: TabProps['ctx'] }) {
  const id = useId();
  const navigate = useNavigate();
  const rowActions = useCallback(
    (item: Item) => [{ id: 'edit', label: t('action.edit'), icon: <Pencil size={14} />, onSelect: () => void navigate(pathFor(kind, item.id)) }],
    [kind, navigate],
  );
  const newLink = {
    to: `${newPathFor(kind)}?service_id=${encodeURIComponent(serviceId)}`,
    label: t(kind === 'routes' ? 'svc.routes.newRoute' : 'svc.routes.newStreamRoute'),
  };
  return (
    <section className="res-embedded" aria-labelledby={id}>
      <h2 className="res-embedded__title" id={id}>
        {t(`kind.${kind}.plural`)}
      </h2>
      {/* A list of other objects, not a field of the service: its search, columns and pager work
          whether or not the service is locked (as the routes list's own do). */}
      <LockProvider locked={false}>
        <DataTable
          kind={kind}
          items={items}
          columns={columns}
          ctx={ctx}
          rowActions={rowActions}
          stateKey={`services.${kind}`}
          loading={loading}
          newLink={newLink}
          emptyState={
            <div className="res-embedded__empty">
              <p className="res-embedded__none">{t(kind === 'routes' ? 'svc.routes.noRoutes' : 'svc.routes.noStreamRoutes')}</p>
              <NewLink kind={kind} to={newLink.to} label={newLink.label} />
            </div>
          }
        />
      </LockProvider>
    </section>
  );
}

export function RoutesTab({ draft, ctx, isNew, original }: TabProps) {
  // With stream mode off, APISIX answers 400 for stream routes: the kind doesn't exist there.
  const streamOn = useSupports('stream_routes');
  const serviceId = isNew ? undefined : (original?.id ?? idOf(draft.id));
  const routes = useMemo(() => ctx.routes.filter((r) => idOf(r.value.service_id) === serviceId), [ctx.routes, serviceId]);
  const streams = useMemo(() => ctx.streamRoutes.filter((r) => idOf(r.value.service_id) === serviceId), [ctx.streamRoutes, serviceId]);

  if (serviceId === undefined) return <p className="res-callout">{t('svc.routes.newNote')}</p>;
  return (
    <div className="ed-stack">
      <Users kind="routes" items={routes} columns={routeColumns} loading={!ctx.loaded.routes} serviceId={serviceId} ctx={ctx} />
      {streamOn !== false && <Users kind="stream_routes" items={streams} columns={streamRouteColumns} loading={!ctx.loaded.streamRoutes} serviceId={serviceId} ctx={ctx} />}
    </div>
  );
}
