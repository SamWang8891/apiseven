// Dev-only showcase of the UI kit at #/__kit (App loads it only when import.meta.env.DEV).
// Gallery copy is developer-facing sample text, not product UI, so it is not in en.ts.
import { Check, CircleAlert, Copy, Lock, Moon, Pencil, Plus, Sun, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Obj } from '../api/types';
import { EditPreview, FormMatrix } from './GalleryForms';
import {
  Badge,
  Button,
  CodeEditor,
  ConfirmDialog,
  Dialog,
  Input,
  LockProvider,
  Menu,
  Select,
  Tabs,
  Toaster,
  Tooltip,
  toast,
} from './index';
import './gallery.css';

type Theme = 'light' | 'dark';

const LIMIT_COUNT_SCHEMA: Obj = {
  type: 'object',
  properties: {
    count: { type: 'integer', exclusiveMinimum: 0, description: 'Requests allowed per window.' },
    time_window: { type: 'integer', exclusiveMinimum: 0, description: 'Window length in seconds.' },
    key_type: { type: 'string', enum: ['var', 'var_combination', 'constant'], default: 'var' },
    key: { type: 'string', default: 'remote_addr' },
    rejected_code: { type: 'integer', minimum: 200, maximum: 599, default: 503 },
    policy: { type: 'string', enum: ['local', 'redis', 'redis-cluster'], default: 'local' },
    show_limit_quota_header: { type: 'boolean', default: true },
  },
  required: ['count', 'time_window'],
  additionalProperties: false,
};

const PLUGIN_JSON = `{
  "count": 100,
  "time_window": "60",
  "key_type": "var",
  "key": "remote_addr",
  "rejected_code": 429
}`;

const UPSTREAM_YAML = `upstream:
  type: chash
  hash_on: header
  key: x-player-id
  nodes:
    - host: backend.internal
      port: 8443
      weight: 100  # primary`;

const LUA = `return function(conf, ctx)
  -- tag requests from the game client
  local ua = ngx.var.http_user_agent or ""
  if ua:find("GameClient/", 1, true) then
    ngx.req.set_header("X-Client", "game")
  end
end`;

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="ui-gallery__section">
      <h2>{title}</h2>
      {note && <p className="ui-gallery__note">{note}</p>}
      <div className="ui-gallery__body">{children}</div>
    </section>
  );
}

function Buttons() {
  return (
    <div className="ui-gallery__stack">
      {(['md', 'sm'] as const).map((size) => (
        <div key={size} className="ui-gallery__line">
          <Button size={size} variant="primary" icon={<Check size={14} />}>
            Save
          </Button>
          <Button size={size}>Discard</Button>
          <Button size={size} variant="ghost" icon={<Plus size={14} />}>
            Add plugin
          </Button>
          <Button size={size} variant="danger" icon={<Trash2 size={14} />}>
            Delete route
          </Button>
          <Button size={size} variant="primary" loading>
            Saving
          </Button>
          <Button size={size} disabled>
            Disabled
          </Button>
          <Button size={size} variant="primary" disabled>
            Disabled
          </Button>
          <Tooltip content="Copy ID">
            <Button size={size} icon={<Copy size={size === 'sm' ? 13 : 15} />} aria-label="Copy ID" />
          </Tooltip>
          <Button size={size} variant="ghost" icon={<Pencil size={size === 'sm' ? 13 : 15} />} aria-label="Edit" />
        </div>
      ))}
    </div>
  );
}

function Badges() {
  return (
    <div className="ui-gallery__line">
      <Badge tone="ok">Enabled</Badge>
      <Badge tone="neutral">Disabled</Badge>
      <Badge tone="warn">Expires in 9 days</Badge>
      <Badge tone="danger" icon={<CircleAlert />}>
        Expired
      </Badge>
      <Badge tone="accent">via service</Badge>
      <Badge tone="neutral" icon={<Lock />}>
        Locked
      </Badge>
    </div>
  );
}

function Overlays() {
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  return (
    <div className="ui-gallery__line">
      <Button onClick={() => setDialog(true)}>Open dialog</Button>
      <Button variant="danger" onClick={() => setConfirm(true)}>
        Delete route…
      </Button>
      <Menu
        trigger={<Button>Menu</Button>}
        items={[
          { id: 'edit', label: 'Edit', icon: <Pencil size={14} />, onSelect: () => toast.info('Edit') },
          { id: 'dup', label: 'Duplicate', icon: <Copy size={14} />, onSelect: () => toast.info('Duplicated') },
          { id: 'off', label: 'Disable', disabled: true, onSelect: () => {} },
          { separator: true },
          { id: 'del', label: 'Delete', icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirm(true) },
        ]}
      />
      <Tooltip content="Matches requests whose Host header is one of these">
        <Button variant="ghost">Hover for tooltip</Button>
      </Tooltip>
      <Button onClick={() => toast.success('Saved route game-api')}>Toast success</Button>
      <Button onClick={() => toast.error('PUT /routes/1 failed: invalid configuration: property "uri" is required')}>Toast error</Button>
      <Button onClick={() => toast.info('Connected to APISIX 3.20.0')}>Toast info</Button>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Add upstream node"
        footer={
          <>
            <Button onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setDialog(false)}>
              Add node
            </Button>
          </>
        }
      >
        <div className="ui-gallery__form ui-gallery__form--single">
          <Input label="Host" mono required value={name} onChange={(e) => setName(e.target.value)} placeholder="backend.internal" />
          <Select label="Scheme" options={[{ value: 'http', label: 'http' }, { value: 'https', label: 'https' }]} value="https" onChange={() => {}} />
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        title="Delete route game-api?"
        body="Requests to api.example.games/v1/* will stop matching. This cannot be undone."
        confirmLabel="Delete route"
        danger
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setBusy(true);
          setTimeout(() => {
            setBusy(false);
            setConfirm(false);
            toast.success('Deleted route game-api');
          }, 900);
        }}
      />
    </div>
  );
}

function Code() {
  const [plugin, setPlugin] = useState(PLUGIN_JSON);
  const [yaml, setYaml] = useState(UPSTREAM_YAML);
  const [lua, setLua] = useState(LUA);
  return (
    <div className="ui-gallery__grid2">
      <div className="ui-gallery__stack">
        <p className="ui-gallery__caption">JSON, editable, with schema lint and completion (Ctrl-Space)</p>
        <CodeEditor language="json" jsonSchema={LIMIT_COUNT_SCHEMA} value={plugin} onChange={setPlugin} minLines={7} aria-label="limit-count config" />
      </div>
      <div className="ui-gallery__stack">
        <p className="ui-gallery__caption">YAML, locked</p>
        <LockProvider locked>
          <CodeEditor language="yaml" value={yaml} onChange={setYaml} minLines={7} aria-label="Upstream YAML" />
        </LockProvider>
        <p className="ui-gallery__caption">Lua, readOnly</p>
        <CodeEditor language="lua" readOnly value={lua} onChange={setLua} minLines={3} maxLines={10} aria-label="Lua" />
      </div>
    </div>
  );
}

export default function Gallery() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  const [tab, setTab] = useState('one');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="ui-gallery">
      <header className="ui-gallery__bar">
        <h1>
          apiseven <span>UI kit</span>
        </h1>
        <div className="ui-gallery__themes" role="group" aria-label="Theme">
          {(['light', 'dark'] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={theme === t ? 'primary' : 'ghost'}
              aria-pressed={theme === t}
              icon={t === 'light' ? <Sun size={13} /> : <Moon size={13} />}
              onClick={() => setTheme(t)}
            >
              {t === 'light' ? 'Light' : 'Dark'}
            </Button>
          ))}
        </div>
      </header>

      <Section title="Edit page" note="Starts locked. Edit swaps each value for its control in place; fields keep their positions.">
        <EditPreview />
      </Section>

      <Section title="Inputs" note="Each row shares one value across its states; edit the first column and the locked one follows.">
        <FormMatrix />
      </Section>

      <Section title="Buttons" note="primary, secondary, ghost, danger; loading; disabled; icon-only (with a tooltip on the first).">
        <Buttons />
      </Section>

      <div className="ui-gallery__grid2">
        <Section title="Badges" note="Colour marks state; the text always names it.">
          <Badges />
        </Section>
        <Section title="Tabs">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'one', label: 'General', content: <p className="ui-gallery__note">General panel.</p> },
              { id: 'two', label: 'Plugins', badge: 3, content: <p className="ui-gallery__note">Plugins panel.</p> },
              { id: 'three', label: 'Advanced', content: <p className="ui-gallery__note">Advanced panel.</p> },
            ]}
          />
        </Section>
      </div>

      <Section title="Overlays">
        <Overlays />
      </Section>

      <Section title="Code editor" note="CodeMirror 6, loaded on first use.">
        <Code />
      </Section>

      <Toaster />
    </div>
  );
}
