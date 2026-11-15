// The consumer editor's General tab: the username (typed only when creating: it is the consumer's id),
// its group, description and labels, then the consumer at a glance (its plugins, those it takes from
// its group, and how many credentials it has), each line linking to its tab. Locked, this is the
// consumer's spec sheet; it names plugins, never their configs (they hold the consumer's keys).
import { useMemo, type ReactNode } from 'react';
import { useList, useSupports } from '../../api/hooks';
import type { Obj } from '../../api/types';
import { setPath } from '../../editor/draft';
import { issueAt } from '../../editor/issues';
import { t } from '../../i18n';
import { consumerGroupLoading, consumerInheritedPlugins } from '../../plugins/inherited';
import { Field, Input, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import type { Ctx } from '../ctx';
import { MetaFields } from '../MetaFields';
import { Mono, Overview, Parts } from '../Overview';
import type { TabProps } from '../registry';
import { ResourcePicker } from '../ResourcePicker';
import { servicePlugins as ownPlugins } from '../services/columns';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const idOf = (v: unknown): string | undefined => (typeof v === 'number' ? String(v) : typeof v === 'string' && v !== '' ? v : undefined);
const named = (p: { name: string; disabled?: boolean }) => (p.disabled ? t('rt.overview.pluginOff', { name: p.name }) : p.name);

/** Its own plugins, then those of its group ("loading…" while the groups load); "None" only when neither has any. */
function plugins(draft: Obj, ctx: Ctx) {
  const own = ownPlugins(draft).map(named);
  const parts: ReactNode[] = own.length > 0 ? [<Mono key="own" values={own} />] : [];
  if (consumerGroupLoading(draft, ctx)) parts.push(t('picker.loading'));
  else {
    const inherited = consumerInheritedPlugins(draft, ctx).map(named);
    if (inherited.length > 0) parts.push(t('cs.overview.fromGroup', { names: inherited.join(', ') }));
  }
  return parts.length > 0 ? <Parts parts={parts} /> : t('cs.overview.noPlugins');
}

/** How many credentials the stored consumer has (the Credentials tab's list, fetched once). */
function Credentials({ username }: { username: string }) {
  const parent = useMemo(() => ({ consumer: username }), [username]);
  const list = useList('credentials', parent);
  if (list.data) {
    const count = list.data.length;
    return <>{count === 0 ? t('cs.overview.noCredentials') : count === 1 ? t('cs.overview.credentialOne') : t('cs.overview.credentialCount', { count })}</>;
  }
  return <>{list.isError ? t('cs.overview.credentialsFailed') : t('picker.loading')}</>;
}

export function GeneralTab({ draft, setDraft, issues, ctx, isNew, original, saveAttempts }: TabProps) {
  const locked = useLocked();
  const credentialsOn = useSupports('credentials') !== false;
  const username = text(draft.username);
  // "Enter a username" waits for a Save attempt; a username APISIX refuses is flagged as it is typed.
  const usernameError = username !== '' || saveAttempts > 0 ? issueAt(issues, 'username') : undefined;
  const stored = isNew ? undefined : (original?.id ?? (username || undefined));
  const groupId = idOf(draft.group_id);

  return (
    <div className="ed-stack">
      <div className="ed-grid">
        {isNew ? (
          <Input
            label={t('cs.general.username')}
            required
            mono
            value={username}
            help={t('cs.general.usernameHelp')}
            error={usernameError}
            onChange={(e) => setDraft(setPath(draft, ['username'], e.target.value))}
          />
        ) : (
          <Field label={t('cs.general.username')} help={locked ? undefined : t('cs.general.usernameFixed')} error={issueAt(issues, 'username')}>
            <ReadOnlyValue mono>{username}</ReadOnlyValue>
          </Field>
        )}
        {locked && groupId === undefined ? (
          <Field label={t('cs.general.group')} error={issueAt(issues, 'group_id')}>
            <ReadOnlyValue>{t('cs.general.noGroup')}</ReadOnlyValue>
          </Field>
        ) : (
          <ResourcePicker
            kind="consumer_groups"
            items={ctx.consumerGroups}
            loading={!ctx.loaded.consumerGroups}
            clearable
            label={t('cs.general.group')}
            help={locked ? undefined : t('cs.general.groupHelp')}
            placeholder={t('cs.general.noGroup')}
            value={groupId}
            error={issueAt(issues, 'group_id')}
            onChange={(id) => setDraft(setPath(draft, ['group_id'], id))}
          />
        )}
        <MetaFields
          draft={draft}
          setDraft={setDraft}
          issues={issues}
          labels={{ desc: t('cs.general.desc'), labels: t('cs.general.labels'), labelsHelp: t('cs.general.labelsHelp') }}
        />
      </div>
      <Overview
        title={t('cs.overview')}
        rows={[
          { tab: 'plugins', label: t('pl.tab'), value: plugins(draft, ctx) },
          ...(credentialsOn
            ? [{ tab: 'credentials', label: t('cs.tab.credentials'), value: stored === undefined ? t('cs.overview.credentialsNew') : <Credentials username={stored} /> }]
            : []),
        ]}
      />
    </div>
  );
}
