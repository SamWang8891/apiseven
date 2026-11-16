// The consumer editor's General tab: the username (typed only when creating: it is the consumer's id),
// its group, description and labels, then the consumer at a glance (its plugins, those it takes from
// its group, and how many credentials it has), each line linking to its tab. Locked, this is the
// consumer's spec sheet; it names plugins, never their configs (they hold the consumer's keys).
import { Fragment, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAllPlugins, useList, useSupports } from '../../api/hooks';
import type { Obj, PluginInfo } from '../../api/types';
import { setPath } from '../../editor/draft';
import { issueAt } from '../../editor/issues';
import { t } from '../../i18n';
import { pathFor } from '../../router/paths';
import { decryptsOnly } from '../../plugins/auth';
import { consumerGroupLoading, consumerInheritedPlugins } from '../../plugins/inherited';
import { Badge, Field, Input, useLocked } from '../../ui';
import type { PluginChip } from '../cells';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import type { Ctx } from '../ctx';
import { MetaFields } from '../MetaFields';
import { Overview, Parts } from '../Overview';
import type { TabProps } from '../registry';
import { findInCtx } from '../resolve';
import { ResourcePicker } from '../ResourcePicker';
import { scopedPlugins } from '../scopedPlugins';
import { pluginName } from '../pluginName';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const idOf = (v: unknown): string | undefined => (typeof v === 'number' ? String(v) : typeof v === 'string' && v !== '' ? v : undefined);
const named = (p: PluginChip) =>
  p.noEffect
    ? pluginName(p)
    : p.notApplied
    ? t('cs.overview.notApplied', { name: p.name })
    : p.notUsed
      ? t('cs.overview.notUsed', { name: p.name })
      : p.offIgnored
        ? t('cs.overview.offIgnored', { name: p.name })
        : p.disabled
          ? t(p.unclassified ? 'cs.overview.markedOff' : 'rt.overview.pluginOff', { name: p.name })
          : p.name;

/**
 * Its own plugins by name: one stored off reads "(off)", unless it is an auth plugin, whose off APISIX
 * ignores: with what it is found by and checked against it still signs in (jwe-decrypt: is still
 * used; a danger badge), without it it signs nobody in ("(off)"), and with its lookup field unknown it
 * reads "off ignored"; one this APISIX doesn't know is not used (scopedPlugins).
 */
function Own({ plugins }: { plugins: PluginChip[] }) {
  return (
    <span>
      {plugins.map((p, i) => (
        <Fragment key={p.name}>
          {i > 0 && ', '}
          <span className="mono">{named(p)}</span>
          {p.stillSignsIn && (
            <>
              {' '}
              <Badge tone="danger">{t(decryptsOnly(p.name) ? 'cs.overview.stillUsed' : 'cs.overview.stillSignsIn')}</Badge>
            </>
          )}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Its own plugins, then those of its group ("loading…" while the groups load): one it sets itself
 * reads "overridden here" (its own wins, merge_consumer_route), a group's auth plugin "sign-in
 * skipped" (plugins/auth.ts). "None" only when neither has any.
 */
function plugins(draft: Obj, ctx: Ctx, all: Record<string, PluginInfo> | undefined) {
  const own = scopedPlugins(draft, 'consumer', all);
  const parts: ReactNode[] = own.length > 0 ? [<Own key="own" plugins={own} />] : [];
  if (consumerGroupLoading(draft, ctx)) parts.push(t('picker.loading'));
  else {
    const mine = new Set(own.map((p) => p.name));
    const inherited = consumerInheritedPlugins(draft, ctx, all).map((p) => (!p.notApplied && mine.has(p.name) ? t('cs.overview.overridden', { name: p.name }) : named(p)));
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
  const all = useAllPlugins().data;
  const username = text(draft.username);
  // "Enter a username" waits for a Save attempt; a username APISIX refuses is flagged as it is typed.
  const usernameError = username !== '' || saveAttempts > 0 ? issueAt(issues, 'username') : undefined;
  const stored = isNew ? undefined : (original?.id ?? (username || undefined));
  const groupId = idOf(draft.group_id);
  // Creating over a username a loaded consumer has would replace that consumer: say so as it is
  // typed (it doesn't block Save; the editor's check before the create does, editor/save.ts).
  const taken = isNew && username !== '' ? findInCtx('consumers', username, ctx) : undefined;

  return (
    <div className="ed-stack">
      <div className="ed-grid">
        {isNew ? (
          <div>
            <Input
              label={t('cs.general.username')}
              required
              mono
              value={username}
              help={t('cs.general.usernameHelp')}
              error={usernameError ?? (taken ? t('editor.taken.message', { kind: t('kind.consumers.singular'), id: taken.id }) : undefined)}
              onChange={(e) => setDraft(setPath(draft, ['username'], e.target.value))}
            />
            {taken && (
              <Link className="res-taken" to={pathFor('consumers', taken.id)}>
                {t('editor.taken.open', { kind: t('kind.consumers.singular'), id: taken.id })}
              </Link>
            )}
          </div>
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
          { tab: 'plugins', label: t('pl.tab'), value: plugins(draft, ctx, all) },
          ...(credentialsOn
            ? [{ tab: 'credentials', label: t('cs.tab.credentials'), value: stored === undefined ? t('cs.overview.credentialsNew') : <Credentials username={stored} /> }]
            : []),
        ]}
      />
    </div>
  );
}
