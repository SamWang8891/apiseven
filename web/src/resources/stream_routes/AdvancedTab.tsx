// The stream route editor's Advanced tab: TLS passthrough (consulted only on a listen that both
// terminates and passes TLS through) and the xRPC protocol the route speaks (`protocol`: its name, a
// superior route whose protocol it shares, and its `conf` and `logger` as JSON). Only what the
// stream_route schema has (apisix/schema_def.lua 1037–1073, 1115–1121).
import { useMemo } from 'react';
import { isObj } from '../../api/sanitize';
import type { Obj } from '../../api/types';
import { setPath } from '../../editor/draft';
import { issueAt, issuesUnder, withinPath } from '../../editor/issues';
import { t } from '../../i18n';
import { SchemaForm } from '../../schema-form/SchemaForm';
import { Field, Input, Switch, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import type { TabProps } from '../registry';
import { ResourcePicker } from '../ResourcePicker';
import { Section } from '../Section';
import '../resources.css';

const idOf = (v: unknown): string | undefined => (typeof v === 'number' ? String(v) : typeof v === 'string' && v !== '' ? v : undefined);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The protocol with `conf` and `logger` set from the form (an undefined one removed). */
function withParts(protocol: Obj, parts: unknown): Obj {
  const next: Obj = { ...protocol };
  const from = isObj(parts) ? parts : {};
  for (const key of ['conf', 'logger']) {
    if (from[key] === undefined) delete next[key];
    else next[key] = from[key];
  }
  return next;
}

function Protocol({ draft, setDraft, issues, ctx }: Pick<TabProps, 'draft' | 'setDraft' | 'issues' | 'ctx'>) {
  const locked = useLocked();
  const protocol = isObj(draft.protocol) ? draft.protocol : {};
  const ownId = idOf(draft.id);
  // conf and logger are any JSON to the form (no `type` in these sub-schemas): their types are
  // streamRouteIssues' to judge, so what the text says is what is emitted once it parses.
  const parts = useMemo(
    () => ({ type: 'object', properties: { conf: { description: t('sr.adv.confHelp') }, logger: { description: t('sr.adv.loggerHelp') } } }),
    [],
  );
  const partIssues = withinPath([...issuesUnder(issues, 'protocol.conf'), ...issuesUnder(issues, 'protocol.logger')], 'protocol');
  return (
    <div className="ed-stack">
      {!locked && <p className="ed-note">{t('sr.adv.protocolHelp')}</p>}
      <div className="ed-grid">
        <Input
          label={t('sr.adv.protocolName')}
          mono
          value={text(protocol.name)}
          error={issueAt(issues, 'protocol.name') ?? issueAt(issues, 'protocol')}
          onChange={(e) => setDraft(setPath(draft, ['protocol', 'name'], e.target.value))}
        />
        <ResourcePicker
          kind="stream_routes"
          items={ctx.streamRoutes}
          loading={!ctx.loaded.streamRoutes}
          clearable
          label={t('sr.adv.superior')}
          help={locked ? undefined : t('sr.adv.superiorHelp')}
          placeholder={t('sr.adv.noSuperior')}
          filter={(item) => String(item.id) !== ownId}
          value={idOf(protocol.superior_id)}
          error={issueAt(issues, 'protocol.superior_id')}
          onChange={(id) => setDraft(setPath(draft, ['protocol', 'superior_id'], id))}
        />
      </div>
      <SchemaForm
        schema={parts}
        name="protocol"
        value={{ conf: protocol.conf, logger: protocol.logger }}
        errors={partIssues}
        onChange={(v) => setDraft(setPath(draft, ['protocol'], withParts(protocol, v)))}
      />
    </div>
  );
}

export function AdvancedTab({ draft, setDraft, issues, ctx, original }: TabProps) {
  const locked = useLocked();
  const protocolIssues = issuesUnder(issues, 'protocol');
  const name = isObj(draft.protocol) ? text(draft.protocol.name) : '';
  // false is the default: off removes the key, or gives back the false that was stored.
  const passOff = original?.value.tls_passthrough === false ? false : undefined;
  return (
    <div className="ed-stack">
      <div className="ed-grid">
        <Switch
          label={t('sr.adv.passthrough')}
          help={locked ? undefined : t('sr.adv.passthroughHelp')}
          checked={draft.tls_passthrough === true}
          error={issueAt(issues, 'tls_passthrough')}
          onChange={(on) => setDraft(setPath(draft, ['tls_passthrough'], on ? true : passOff))}
        />
      </div>
      {locked && draft.protocol === undefined ? (
        <div className="ed-grid">
          <Field label={t('sr.adv.protocol')}>
            <ReadOnlyValue>{t('sr.adv.noProtocol')}</ReadOnlyValue>
          </Field>
        </div>
      ) : (
        <div className="res-wide">
          <Section
            title={t('sr.adv.protocol')}
            summary={draft.protocol === undefined ? t('sr.adv.noProtocol') : name || t('sr.adv.protocolUnnamed')}
            issues={protocolIssues.length}
            defaultOpen={draft.protocol !== undefined}
          >
            <Protocol draft={draft} setDraft={setDraft} issues={issues} ctx={ctx} />
          </Section>
        </div>
      )}
    </div>
  );
}
