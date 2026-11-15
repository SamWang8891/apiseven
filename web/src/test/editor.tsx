import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Kind, Obj } from '../api/types';
import { getPath, setPath } from '../editor/draft';
import { issueAt } from '../editor/issues';
import { registry, type ResourceDef, type TabDef, type TabProps } from '../resources/registry';
import { Input } from '../ui';
import { DEV_CONN, renderApp, saveConnections } from './app';
import type { FakeAdminOptions } from './fakeAdmin';

type Overridable = Pick<ResourceDef, 'tabs' | 'validate' | 'idFromDraft' | 'idMode' | 'blank' | 'hasStatus' | 'NewId' | 'ListComponent' | 'createWhenMissing' | 'idProblem'>;

/**
 * Replaces fields of a kind's registry entry for one test and returns the undo (call it in
 * afterEach). The entry is changed in place: its i18n getters stay intact.
 */
export function overrideDef(kind: Kind, patch: Partial<Overridable>): () => void {
  const def = registry[kind] as unknown as Record<string, unknown>;
  const saved = Object.keys(patch).map((key) => [key, Object.getOwnPropertyDescriptor(def, key)] as const);
  Object.assign(def, patch);
  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(def, key, descriptor);
      else delete def[key];
    }
  };
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A tab in the shape later tasks build: kit inputs bound to the draft through setPath, issues beside the fields. */
function generalFields({ draft, setDraft, issues }: TabProps) {
  const bind = (key: string) => ({
    value: text(getPath(draft, [key])),
    onChange: (e: { target: { value: string } }) => setDraft(setPath(draft, [key], e.target.value)),
    error: issueAt(issues, key),
  });
  return (
    <div className="ed-grid">
      <Input label="Name" {...bind('name')} />
      <Input label="URI" mono {...bind('uri')} />
    </div>
  );
}

/** A General tab owning `name` and `uri`, for page-level tests. */
export const GENERAL_TAB: TabDef = { id: 'general', label: 'General', fields: ['name', 'uri'], render: generalFields };

/** A tab holding a plain <input> that ignores the lock, to type into while the page is locked. */
export const PROBE_TAB: TabDef = { id: 'probe', label: 'Probe', fields: [], render: () => <input aria-label="probe" /> };

/** The whole app at `hash` (a fake Admin API with no objects but `opts.objects`), once the main area is there. */
export async function openEditor(hash: string, opts: FakeAdminOptions = {}) {
  saveConnections([DEV_CONN], DEV_CONN.id);
  const user = userEvent.setup();
  const app = renderApp({ hash, counts: {}, ...opts });
  await screen.findByRole('main');
  return { user, ...app };
}

export const main = () => within(screen.getByRole('main'));

/** The writes the page sent: method, admin path (still encoded) and parsed body. */
export function writesOf(admin: { requests: { method: string; url: URL; body?: unknown }[] }) {
  return admin.requests
    .filter((r) => r.method !== 'GET')
    .map((r) => ({ method: r.method, path: r.url.pathname.replace(/^.*\/apisix\/admin\//, ''), body: r.body as Obj | undefined }));
}

/** The JSON tab's CodeMirror editor, once it has loaded. */
export function jsonEditor(kindSingular: string) {
  return screen.findByRole('textbox', { name: `${kindSingular} as JSON` });
}
