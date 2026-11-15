// The plugin metadata list (ResourceDef.ListComponent): a row for every plugin with metadata settings,
// configured or not, and for every stored entry (rows.ts). Nothing definite is shown until both the
// plugin list and the stored entries are in: the table says it is loading until then. A row opens
// the plugin's editor, which creates the entry when there is none (ResourceDef.createWhenMissing);
// Reset, offered only for a configured plugin, deletes the entry after a confirmation.
import { Pencil, RotateCcw } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAllPlugins, useList } from '../../api/hooks';
import type { Item, Kind } from '../../api/types';
import { useReadOnlyKey } from '../../api/write';
import { t } from '../../i18n';
import { DeleteResourceDialog } from '../../pages/RowActions';
import { pathFor } from '../../router/paths';
import { pageTitle, useDocumentTitle } from '../../shell/documentTitle';
import { DataTable } from '../../table/DataTable';
import { NewLink } from '../../table/Toolbar';
import { registry, useCtx } from '../registry';
import { metadataColumns } from './columns';
import { metadataRows, type MetadataRow } from './rows';
import '../../pages/list.css';
import '../resources.css';

const NONE: Item[] = [];

export function MetadataListPage({ kind }: { kind: Kind }) {
  const def = registry[kind];
  const plugins = useAllPlugins();
  const list = useList(kind);
  const ctx = useCtx();
  const navigate = useNavigate();
  const readOnly = useReadOnlyKey();
  const [resetting, setResetting] = useState<Item>();
  useDocumentTitle(pageTitle(def.plural));
  const settled = plugins.data !== undefined || plugins.isError;
  const rows = useMemo(() => (list.data && settled ? metadataRows(plugins.data, list.data) : undefined), [list.data, settled, plugins.data]);

  const rowActions = useCallback(
    (item: Item) => {
      const { stored } = item as MetadataRow;
      return [
        { id: 'edit', label: t('action.edit'), icon: <Pencil size={14} />, onSelect: () => void navigate(pathFor(kind, item.id)) },
        ...(stored
          ? [{ separator: true as const }, { id: 'reset', label: t('action.reset'), icon: <RotateCcw size={14} />, danger: true, disabled: readOnly, onSelect: () => setResetting(stored) }]
          : []),
      ];
    },
    [kind, navigate, readOnly],
  );

  return (
    <div className="shell-page shell-page--fill">
      <div className="shell-page__head">
        <div className="list-title">
          <h1 tabIndex={-1}>{def.plural}</h1>
          {rows && <span className="list-title__count">{rows.length}</span>}
        </div>
        <NewLink kind={kind} />
      </div>
      <p className="res-note res-note--page">{t('pm.help')}</p>
      {plugins.isError && (
        <p className="res-note res-note--warn res-note--page" role="status">
          {t('pm.listFailed', { error: plugins.error.message })}
        </p>
      )}
      <DataTable
        kind={kind}
        items={rows ?? NONE}
        columns={metadataColumns}
        ctx={ctx}
        rowActions={rowActions}
        noNewButton
        loading={rows === undefined && !list.error}
        error={list.data ? undefined : (list.error ?? undefined)}
        onRetry={() => void list.refetch()}
      />
      {resetting && <DeleteResourceDialog open kind={kind} item={resetting} ctx={ctx} onClose={() => setResetting(undefined)} />}
    </div>
  );
}
