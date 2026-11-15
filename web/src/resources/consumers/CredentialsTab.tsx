// The consumer editor's Credentials tab: the consumer's credentials as a table of their own (sortable,
// with its own columns, remembered under consumers.credentials), each opening in its own editor.
// Credentials are objects of their own, saved apart from the consumer: the tab edits nothing of the
// consumer and owns no fields. Its writes are the credentials' own and never one click: New opens
// the credential editor (which saves on its own Create), and Delete asks first (DeleteResourceDialog).
// Both are there whether or not the consumer is locked, as on a list page. A consumer not saved yet
// has no credentials, so the tab says so instead.
import { Pencil, Trash2 } from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useList } from '../../api/hooks';
import type { Item } from '../../api/types';
import { useReadOnlyKey } from '../../api/write';
import { t } from '../../i18n';
import { DeleteResourceDialog } from '../../pages/RowActions';
import { newPathFor, pathFor } from '../../router/paths';
import { DataTable } from '../../table/DataTable';
import { NewLink } from '../../table/Toolbar';
import { LockProvider } from '../../ui';
import { credentialColumns } from '../credentials/columns';
import type { TabProps } from '../registry';
import '../resources.css';

const NONE: Item[] = [];

function Credentials({ username, ctx }: { username: string; ctx: TabProps['ctx'] }) {
  const id = useId();
  const navigate = useNavigate();
  const readOnly = useReadOnlyKey();
  const parent = useMemo(() => ({ consumer: username }), [username]);
  const list = useList('credentials', parent);
  /** The credential the delete dialog asks about (view state: a dialog, which a Save cannot pass). */
  const [deleting, setDeleting] = useState<Item>();
  const rowActions = useCallback(
    (item: Item) => [
      { id: 'edit', label: t('action.edit'), icon: <Pencil size={14} />, onSelect: () => void navigate(pathFor('credentials', item.id, parent)) },
      { separator: true as const },
      { id: 'delete', label: t('action.delete'), icon: <Trash2 size={14} />, danger: true, disabled: readOnly, onSelect: () => setDeleting(item) },
    ],
    [navigate, parent, readOnly],
  );
  const newLink = { to: newPathFor('credentials', parent), label: t('cs.credentials.new') };

  return (
    <section className="res-embedded" aria-labelledby={id}>
      <h2 className="res-embedded__title" id={id}>
        {t('kind.credentials.plural')}
      </h2>
      <p className="res-embedded__help">{t('cs.credentials.help')}</p>
      {/* A list of other objects, not a field of the consumer: its search, columns and pager work
          whether or not the consumer is locked (as the list pages' own do). */}
      <LockProvider locked={false}>
        <DataTable
          kind="credentials"
          parent={parent}
          items={list.data ?? NONE}
          columns={credentialColumns}
          ctx={ctx}
          rowActions={rowActions}
          stateKey="consumers.credentials"
          loading={list.isPending}
          error={list.data ? undefined : (list.error ?? undefined)}
          onRetry={() => void list.refetch()}
          newLink={newLink}
          emptyState={
            <div className="res-embedded__empty">
              <p className="res-embedded__none">{t('cs.credentials.none')}</p>
              <NewLink kind="credentials" parent={parent} to={newLink.to} label={newLink.label} />
            </div>
          }
        />
      </LockProvider>
      {deleting && <DeleteResourceDialog open kind="credentials" item={deleting} parent={parent} ctx={ctx} onClose={() => setDeleting(undefined)} />}
    </section>
  );
}

export function CredentialsTab({ draft, ctx, isNew, original }: TabProps) {
  const username = isNew ? undefined : (original?.id ?? (typeof draft.username === 'string' && draft.username !== '' ? draft.username : undefined));
  if (username === undefined) return <p className="res-callout">{t('cs.credentials.newNote')}</p>;
  return <Credentials username={username} ctx={ctx} />;
}
