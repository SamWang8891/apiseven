// Dev-only (see Gallery.tsx): every input in its states, and an edit page sketch to judge the locked
// look in context. Gallery copy is developer-facing sample text, not product UI, so it is not in en.ts.
import { Ellipsis, Lock, Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Input,
  KeyValueInput,
  LockProvider,
  Menu,
  NumberInput,
  Segmented,
  Select,
  Switch,
  TagInput,
  Tabs,
  Textarea,
  toast,
  type Option,
} from './index';

const BALANCERS: Option[] = [
  { value: 'roundrobin', label: 'Round robin', description: 'Weighted, in turn' },
  { value: 'chash', label: 'Consistent hash', description: 'Same key, same node' },
  { value: 'ewma', label: 'EWMA', description: 'Lowest recent latency' },
  { value: 'least_conn', label: 'Least connections' },
];

const SERVICES: Option[] = [
  { value: 'game-backend', label: 'game-backend', description: 'id 491004173451675648' },
  { value: 'auth', label: 'auth', description: 'id 491004173451675650' },
];

const SCHEMES: Option[] = ['http', 'https', 'grpc', 'grpcs', 'tcp', 'tls', 'udp', 'kafka'].map((s) => ({ value: s, label: s }));

const isHost = (tag: string) => (/^[a-z0-9*.-]+$/i.test(tag) ? undefined : `“${tag}” is not a host name`);

type State = 'editable' | 'error' | 'locked' | 'disabled';
const STATES: State[] = ['editable', 'error', 'locked', 'disabled'];

/** One row of the matrix: the same control and value in each state. */
function Row({ name, render }: { name: string; render: (state: State) => ReactNode }) {
  return (
    <>
      <div className="ui-gallery__rowhead">{name}</div>
      {STATES.map((state) => (
        <div key={state} className="ui-gallery__cell">
          <LockProvider locked={state === 'locked'}>{render(state)}</LockProvider>
        </div>
      ))}
    </>
  );
}

export function FormMatrix() {
  const [name, setName] = useState('game-api');
  const [host, setHost] = useState('backend.internal');
  const [key, setKey] = useState('edd1c9f034335f136f87ad84b625c8f1');
  const [port, setPort] = useState<number | undefined>(8443);
  const [desc, setDesc] = useState('Public API for the game client.\nRate limited per consumer.');
  const [balancer, setBalancer] = useState<string | undefined>('chash');
  const [scheme, setScheme] = useState<string | undefined>('https');
  const [enabled, setEnabled] = useState(true);
  const [target, setTarget] = useState('nodes');
  const [verify, setVerify] = useState(false);
  const [hosts, setHosts] = useState(['api.example.games', 'm.example.games']);
  const [labels, setLabels] = useState<Record<string, string>>({ env: 'prod', team: 'platform' });

  const err = (state: State, message: string) => (state === 'error' ? message : undefined);
  const off = (state: State) => state === 'disabled';

  return (
    <div className="ui-gallery__matrix">
      <div className="ui-gallery__colhead" />
      {STATES.map((s) => (
        <div key={s} className="ui-gallery__colhead">
          {s}
        </div>
      ))}
      <Row
        name="Input"
        render={(s) => (
          <Input label="Name" required help="Shown in lists." value={name} onChange={(e) => setName(e.target.value)} error={err(s, 'Name is required')} disabled={off(s)} />
        )}
      />
      <Row
        name="Input mono"
        render={(s) => <Input label="Upstream host" mono value={host} onChange={(e) => setHost(e.target.value)} error={err(s, 'Not a valid host')} disabled={off(s)} />}
      />
      <Row
        name="Input secret"
        render={(s) => <Input label="Admin key" secret mono value={key} onChange={(e) => setKey(e.target.value)} error={err(s, 'Key rejected (401)')} disabled={off(s)} />}
      />
      <Row
        name="NumberInput"
        render={(s) => <NumberInput label="Port" integer min={1} max={65535} value={port} onChange={setPort} error={err(s, 'Must be 65535 or less')} disabled={off(s)} />}
      />
      <Row
        name="Textarea"
        render={(s) => <Textarea label="Description" rows={2} value={desc} onChange={setDesc} error={err(s, 'Too long')} disabled={off(s)} />}
      />
      <Row
        name="Select"
        render={(s) => <Select label="Load balancer" options={BALANCERS} value={balancer} onChange={setBalancer} error={err(s, 'Pick a balancer')} disabled={off(s)} />}
      />
      <Row
        name="Select search"
        render={(s) => (
          <Select label="Scheme" mono searchable clearable placeholder="Default (http)" options={SCHEMES} value={scheme} onChange={setScheme} error={err(s, 'Unsupported')} disabled={off(s)} />
        )}
      />
      <Row
        name="Segmented"
        render={(s) => (
          <Segmented
            label="Send requests to"
            value={target}
            onChange={setTarget}
            error={err(s, 'Pick one')}
            options={[
              { value: 'nodes', label: 'Nodes' },
              { value: 'discovery', label: 'Service discovery', disabled: off(s) },
            ]}
          />
        )}
      />
      <Row
        name="Switch"
        render={(s) => <Switch label="Status" onLabel="Enabled" offLabel="Disabled" checked={enabled} onChange={setEnabled} error={err(s, 'Cannot enable')} disabled={off(s)} />}
      />
      <Row
        name="Checkbox"
        render={(s) => (
          <Checkbox label="TLS" checked={verify} onChange={setVerify} error={err(s, 'Needs a CA')} disabled={off(s)}>
            Verify upstream certificate
          </Checkbox>
        )}
      />
      <Row
        name="TagInput"
        render={(s) => <TagInput label="Hosts" mono validate={isHost} value={hosts} onChange={setHosts} error={err(s, 'At least one host')} disabled={off(s)} />}
      />
      <Row
        name="KeyValueInput"
        render={(s) => <KeyValueInput label="Labels" mono value={labels} onChange={setLabels} error={err(s, 'Keys must be unique')} disabled={off(s)} />}
      />
    </div>
  );
}

/** A route editor sketch: the locked page should read as a spec sheet, and Edit should change only the boxes. */
export function EditPreview() {
  const [locked, setLocked] = useState(true);
  const [tab, setTab] = useState('general');
  const [name, setName] = useState('game-api');
  const [desc, setDesc] = useState('Public API for the game client.');
  const [status, setStatus] = useState(true);
  const [service, setService] = useState<string | undefined>('game-backend');
  const [priority, setPriority] = useState<number | undefined>(10);
  const [hosts, setHosts] = useState(['api.example.games', 'm.example.games']);
  const [uris, setUris] = useState(['/v1/*', '/v2/players/*']);
  const [methods, setMethods] = useState(['GET', 'POST']);
  const [labels, setLabels] = useState<Record<string, string>>({ env: 'prod', team: 'platform' });
  const [websocket, setWebsocket] = useState(false);

  const general = (
    <div className="ui-gallery__form">
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <Select label="Service" clearable searchable placeholder="None" options={SERVICES} value={service} onChange={setService} />
      <Textarea label="Description" rows={2} value={desc} onChange={setDesc} />
      <KeyValueInput label="Labels" mono value={labels} onChange={setLabels} />
      <Switch label="Status" onLabel="Enabled" offLabel="Disabled" checked={status} onChange={setStatus} />
      <NumberInput label="Priority" integer value={priority} onChange={setPriority} help="Higher wins when several routes match." />
    </div>
  );
  const matching = (
    <div className="ui-gallery__form">
      <TagInput label="Hosts" mono validate={isHost} value={hosts} onChange={setHosts} />
      <TagInput label="URIs" mono value={uris} onChange={setUris} error="“/v2/players/*” overlaps route player-api" />
      <TagInput label="Methods" value={methods} onChange={setMethods} help="Empty matches any method." />
      <Checkbox label="WebSocket" checked={websocket} onChange={setWebsocket}>
        Proxy WebSocket upgrades
      </Checkbox>
    </div>
  );

  return (
    <div className="ui-gallery__page">
      <header className="ui-gallery__pagehead">
        <div className="ui-gallery__title">
          <h1>{name}</h1>
          <span className="mono">00000000000000000123</span>
          {locked ? (
            <Badge tone="neutral" icon={<Lock />}>
              Locked
            </Badge>
          ) : (
            <Badge tone="accent" icon={<Pencil />}>
              Editing
            </Badge>
          )}
        </div>
        <div className="ui-gallery__actions">
          {locked ? (
            <Button variant="primary" icon={<Pencil size={14} />} onClick={() => setLocked(false)}>
              Edit
            </Button>
          ) : (
            <>
              <Button onClick={() => setLocked(true)}>Discard</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setLocked(true);
                  toast.success(`Saved route ${name}`);
                }}
              >
                Save
              </Button>
            </>
          )}
          <Menu
            trigger={<Button variant="ghost" icon={<Ellipsis size={16} />} aria-label="More actions" />}
            items={[
              { id: 'dup', label: 'Duplicate', onSelect: () => toast.info('Duplicated') },
              { id: 'json', label: 'View JSON', onSelect: () => setTab('json') },
              { separator: true },
              { id: 'del', label: 'Delete', danger: true, disabled: !locked, onSelect: () => toast.error('Delete refused') },
            ]}
          />
        </div>
      </header>
      <LockProvider locked={locked}>
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'general', label: 'General', content: general },
            { id: 'matching', label: 'Matching', badge: 1, content: matching },
            { id: 'upstream', label: 'Upstream', content: <p className="ui-gallery__note">Upstream form goes here.</p> },
            { id: 'json', label: 'JSON', content: <p className="ui-gallery__note">The whole object as JSON.</p> },
          ]}
        />
      </LockProvider>
    </div>
  );
}
