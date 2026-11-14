// Dev-only page at #/__schema: every plugin schema of the fixture as a generated form, beside its
// live JSON value, with a locked toggle, Ajv errors on demand, and a table of what falls back to JSON.
// For development and visual QA; its copy is developer-facing, so it is not in en.ts.
import { Moon, Sun } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { Obj, PluginInfo } from '../api/types';
import { fieldErrors } from '../schema/ajv';
import { Button, CodeEditor, LockProvider, Select, Switch } from '../ui';
import raw from './fixtures/plugins-3.20.json?raw';
import { SchemaForm } from './SchemaForm';
import { fallbackStats } from './stats';
import './playground.css';

type Subsystem = 'http' | 'stream';
type Kind = 'schema' | 'consumer_schema' | 'metadata_schema';

const fixture = JSON.parse(raw) as Record<Subsystem, Record<string, PluginInfo>>;
const KINDS: Kind[] = ['schema', 'consumer_schema', 'metadata_schema'];
const EMPTY: Obj = {};

interface Row {
  subsystem: Subsystem;
  plugin: string;
  kind: Kind;
  props: number;
  json: string[];
  nested: string[];
}

const rows: Row[] = (['http', 'stream'] as const).flatMap((subsystem) =>
  Object.entries(fixture[subsystem]).flatMap(([plugin, info]) =>
    KINDS.filter((kind) => info[kind]).map((kind) => ({ subsystem, plugin, kind, ...fallbackStats(info[kind] as Obj) })),
  ),
);

export default function Playground() {
  const [params, setParams] = useSearchParams();
  const subsystem: Subsystem = params.get('sub') === 'stream' ? 'stream' : 'http';
  const plugins = Object.keys(fixture[subsystem]).sort();
  const plugin = plugins.includes(params.get('plugin') ?? '') ? (params.get('plugin') as string) : (plugins[0] ?? '');
  const info = fixture[subsystem][plugin];
  const kinds = KINDS.filter((k) => info?.[k]);
  const kind: Kind = kinds.includes(params.get('kind') as Kind) ? (params.get('kind') as Kind) : 'schema';
  const locked = params.get('locked') === '1';
  const validate = params.get('errors') === '1';
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  const schema = info?.[kind] ?? EMPTY;
  const id = `${subsystem}:${plugin}:${kind}`;

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    try {
      const preset = params.get('value');
      return preset ? { [id]: JSON.parse(preset) as unknown } : {};
    } catch {
      return {};
    }
  });
  const value = id in values ? values[id] : EMPTY;
  const setValue = (v: unknown) => setValues((all) => ({ ...all, [id]: v }));

  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [shown, setShown] = useState<unknown>(value);
  if (value !== shown) {
    setShown(value);
    setText(JSON.stringify(value, null, 2));
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const errors = useMemo(() => (validate ? (fieldErrors(schema, value) ?? undefined) : undefined), [validate, schema, value]);
  const set = (key: string, next: string | undefined) =>
    setParams(
      (p) => {
        const copy = new URLSearchParams(p);
        if (next === undefined) copy.delete(key);
        else copy.set(key, next);
        copy.delete('value');
        return copy;
      },
      { replace: true },
    );

  const totals = rows.reduce((sum, r) => ({ props: sum.props + r.props, json: sum.json + r.json.length }), { props: 0, json: 0 });
  const ranked = [...rows].sort((a, b) => b.json.length - a.json.length || b.nested.length - a.nested.length || a.plugin.localeCompare(b.plugin));

  return (
    <div className="sf-pg">
      <header className="sf-pg__bar">
        <h1>
          apiseven <span>schema form</span>
        </h1>
        <div className="sf-pg__pickers">
          <Select aria-label="Subsystem" value={subsystem} options={[{ value: 'http', label: 'http' }, { value: 'stream', label: 'stream' }]} onChange={(v) => set('sub', v === 'stream' ? 'stream' : undefined)} />
          <Select
            aria-label="Plugin"
            searchable
            mono
            value={plugin}
            options={plugins.map((p) => ({ value: p, label: p }))}
            onChange={(v) => set('plugin', v)}
          />
          <Select aria-label="Schema" value={kind} options={kinds.map((k) => ({ value: k, label: k }))} onChange={(v) => set('kind', v === 'schema' ? undefined : v)} />
          <Switch aria-label="Locked" checked={locked} onLabel="Locked" offLabel="Editing" onChange={(on) => set('locked', on ? '1' : undefined)} />
          <Switch aria-label="Ajv errors" checked={validate} onLabel="Errors shown" offLabel="Errors hidden" onChange={(on) => set('errors', on ? '1' : undefined)} />
          <Button size="sm" variant="ghost" onClick={() => setValue({})}>
            Clear
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Toggle theme"
            icon={theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            onClick={() => set('theme', theme === 'dark' ? undefined : 'dark')}
          />
        </div>
      </header>

      <div className="sf-pg__main">
        <section className="sf-pg__form" aria-label="Form">
          <LockProvider locked={locked}>
            <SchemaForm key={id} schema={schema} value={value} onChange={setValue} errors={errors} idPrefix="pg" />
          </LockProvider>
        </section>
        <aside className="sf-pg__json" aria-label="Value">
          <h2>Value</h2>
          <CodeEditor
            language="json"
            jsonSchema={schema}
            value={text}
            minLines={8}
            maxLines={40}
            aria-label="Value as JSON"
            onChange={(next) => {
              setText(next);
              try {
                const parsed: unknown = JSON.parse(next);
                setShown(parsed);
                setValue(parsed);
              } catch {
                // keep typing
              }
            }}
          />
        </aside>
      </div>

      <section className="sf-pg__stats" aria-label="Fallbacks">
        <h2>
          Fallbacks: {totals.json} of {totals.props} top-level properties are JSON editors ({((totals.json / totals.props) * 100).toFixed(1)}%)
        </h2>
        <table>
          <thead>
            <tr>
              <th>Plugin</th>
              <th>Schema</th>
              <th>Fields</th>
              <th>JSON (top level)</th>
              <th>JSON (nested)</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={`${r.subsystem}:${r.plugin}:${r.kind}`} aria-current={r.plugin === plugin && r.kind === kind && r.subsystem === subsystem ? 'true' : undefined}>
                <td>
                  <button
                    type="button"
                    className="sf-pg__link mono"
                    onClick={() =>
                      setParams((p) => {
                        const copy = new URLSearchParams(p);
                        copy.set('plugin', r.plugin);
                        if (r.subsystem === 'stream') copy.set('sub', 'stream');
                        else copy.delete('sub');
                        if (r.kind === 'schema') copy.delete('kind');
                        else copy.set('kind', r.kind);
                        return copy;
                      })
                    }
                  >
                    {r.subsystem === 'stream' ? `stream:${r.plugin}` : r.plugin}
                  </button>
                </td>
                <td className="mono">{r.kind}</td>
                <td>{r.props}</td>
                <td className="mono">{r.json.length > 0 ? `${r.json.length}: ${r.json.join(', ')}` : '0'}</td>
                <td className="mono">{r.nested.length > 0 ? `${r.nested.length}: ${r.nested.join(', ')}` : '0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
