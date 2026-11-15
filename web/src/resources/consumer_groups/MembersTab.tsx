// The consumer group editor's Consumers tab: the consumers whose group is this one, as a table of its
// own (remembered under consumer_groups.members), each opening in its own editor. A consumer joins a
// group through its own `group_id`, so this tab edits nothing and owns no fields; it says how to add
// one, and links to a new consumer that starts in this group (the create page reads `?group_id=`).
// A group not saved yet has no members, so the tab says so instead.
import { Pencil } from 'lucide-react';
import { useCallback, useId, useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { newPathFor, pathFor } from '../../router/paths';
import { DataTable } from '../../table/DataTable';
import { NewLink } from '../../table/Toolbar';
import { LockProvider } from '../../ui';
import { consumerColumns } from '../consumers/columns';
import type { TabProps } from '../registry';
import { membersOf } from './columns';
import '../resources.css';

const NONE: Item[] = [];

function Members({ groupId, ctx }: { groupId: string; ctx: TabProps['ctx'] }) {
  const id = useId();
  const navigate = useNavigate();
  const members = useMemo(() => membersOf(groupId, ctx) ?? NONE, [groupId, ctx]);
  const rowActions = useCallback(
    (item: Item) => [{ id: 'edit', label: t('action.edit'), icon: <Pencil size={14} />, onSelect: () => void navigate(pathFor('consumers', item.id)) }],
    [navigate],
  );
  const newLink = { to: `${newPathFor('consumers')}?group_id=${encodeURIComponent(groupId)}`, label: t('cg.members.new') };

  return (
    <section className="res-embedded" aria-labelledby={id}>
      <h2 className="res-embedded__title" id={id}>
        {t('cg.tab.members')}
      </h2>
      <p className="res-embedded__help">{t('cg.members.help')}</p>
      {/* A list of other objects, not a field of the group: its view controls work while it is locked. */}
      <LockProvider locked={false}>
        <DataTable
          kind="consumers"
          items={members}
          columns={consumerColumns}
          ctx={ctx}
          rowActions={rowActions}
          stateKey="consumer_groups.members"
          loading={!ctx.loaded.consumers}
          newLink={newLink}
          emptyState={
            <div className="res-embedded__empty">
              <p className="res-embedded__none">{t('cg.members.none')}</p>
              <NewLink kind="consumers" to={newLink.to} label={newLink.label} />
            </div>
          }
        />
      </LockProvider>
    </section>
  );
}

export function MembersTab({ draft, ctx, isNew, original }: TabProps) {
  const groupId = isNew ? undefined : (original?.id ?? (typeof draft.id === 'string' && draft.id !== '' ? draft.id : undefined));
  if (groupId === undefined) return <p className="res-callout">{t('cg.members.newNote')}</p>;
  return <Members groupId={groupId} ctx={ctx} />;
}
