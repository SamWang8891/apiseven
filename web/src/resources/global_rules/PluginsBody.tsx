// The global rule editor's Plugins tab: what APISIX does with a global rule's plugins (each sentence
// from the 3.20 source, cited below), a note when another stored global rule holds the same plugin
// (APISIX refuses that), and the plugin cards.
import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import { useList } from '../../api/hooks';
import { isObj } from '../../api/sanitize';
import { t } from '../../i18n';
import { DraftPluginsTab } from '../../plugins/PluginsTab';
import type { TabProps } from '../registry';
import '../resources.css';

/**
 * - every request, also one no route matches: init.lua 1001–1010 (rewrite and access, then 404);
 * - before the route's own plugins in each phase, the access phase after the route's rewrite phase
 *   and the consumer merge: init.lua 1056–1107, and common_phase 664–680 for the later phases;
 *   a consumer's plugins go into the route (plugin.merge_consumer_route, init.lua 1081–1086);
 * - prometheus, request-decompress and skywalking have run_policy "prefer_route" (prometheus.lua 87,
 *   request-decompress.lua 74, skywalking.lua 69), so plugin.filter skips them when the route has
 *   the plugin on (plugin.lua 599–605);
 * - one rule per plugin: admin/global_rules.lua 59–83 refuses a second, and merge_global_rules
 *   removes a plugin two rules hold from the run (plugin.lua 1565–1580);
 * - a plugin switched off (`_meta.disable`) is skipped by plugin.filter (plugin.lua 595–597): the
 *   cards and the list say "off".
 */
/** Where the explainer remembers whether its details are open ('1') or not. */
export const EXPLAINER_KEY = 'apiseven.globalRules.explainer';

function storedOpen(): boolean {
  try {
    return localStorage.getItem(EXPLAINER_KEY) === '1';
  } catch {
    return false;
  }
}

/** One line always in view; the details behind a disclosure that stays as the user left it (view state). */
function Explainer() {
  const [open, setOpen] = useState(storedOpen);
  const detailsId = useId();
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(EXPLAINER_KEY, open ? '0' : '1');
    } catch {
      // Not stored: the choice lasts while the page shows.
    }
  };
  return (
    <section className="res-explain" aria-label={t('gr.explainer.title')}>
      <div className="res-explain__head">
        <h3 className="res-explain__title">{t('gr.explainer.title')}</h3>
        <button type="button" className="res-explain__toggle" aria-expanded={open} aria-controls={open ? detailsId : undefined} onClick={toggle}>
          <ChevronRight className="res-explain__chevron" size={14} aria-hidden="true" />
          {t('gr.explainer.how')}
        </button>
      </div>
      {open && (
        <ul id={detailsId} className="res-explain__list">
          <li>{t('gr.explainer.every')}</li>
          <li>{t('gr.explainer.order')}</li>
          <li>{t('gr.explainer.prefer')}</li>
          <li>{t('gr.explainer.once')}</li>
        </ul>
      )}
    </section>
  );
}

/** The plugins of this draft that another stored global rule also holds, by rule; [] until the rules have loaded. */
function sharedWith(id: string | undefined, plugins: unknown, rules: { id: string; value: Record<string, unknown> }[] | undefined): { id: string; names: string[] }[] {
  if (!rules || !isObj(plugins)) return [];
  const mine = Object.keys(plugins);
  return rules
    .filter((rule) => rule.id !== id && isObj(rule.value.plugins))
    .map((rule) => ({ id: rule.id, names: mine.filter((name) => Object.hasOwn(rule.value.plugins as object, name)).sort() }))
    .filter((rule) => rule.names.length > 0);
}

export function PluginsBody(p: TabProps) {
  const rules = useList('global_rules').data;
  const shared = sharedWith(p.id, p.draft.plugins, rules);
  return (
    <div className="ed-stack">
      <Explainer />
      {shared.map((rule) => (
        <p key={rule.id} className="res-note res-note--warn" role="note">
          {t('gr.elsewhere', { id: rule.id, names: rule.names.join(', ') })}
        </p>
      ))}
      <DraftPluginsTab {...p} scope="global_rule" />
    </div>
  );
}
