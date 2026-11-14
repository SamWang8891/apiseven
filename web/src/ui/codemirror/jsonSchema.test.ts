import { CompletionContext, insertCompletionText } from '@codemirror/autocomplete';
import { json } from '@codemirror/lang-json';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { schemaCompletionSource, schemaDiagnostics } from './jsonSchema';

const schema: Obj = {
  type: 'object',
  properties: {
    uri: { type: 'string', description: 'Path to match' },
    priority: { type: 'integer' },
    status: { type: 'integer', enum: [0, 1] },
    enable_websocket: { type: 'boolean' },
    upstream: { $ref: '#/definitions/upstream' },
    plugins: { type: 'object' },
  },
  required: ['uri'],
  additionalProperties: false,
  definitions: {
    upstream: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['roundrobin', 'chash'] },
        nodes: { type: 'array', items: { type: 'object', properties: { host: { type: 'string' }, port: { type: 'integer' } } } },
      },
    },
  },
};

/** A parsed JSON editor state; `|` in the source marks the cursor and is removed. */
function stateOf(source: string): { state: EditorState; pos: number } {
  const pos = source.indexOf('|');
  const doc = pos === -1 ? source : source.slice(0, pos) + source.slice(pos + 1);
  const state = EditorState.create({ doc, extensions: [json()] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return { state, pos: pos === -1 ? doc.length : pos };
}

function lint(source: string) {
  const { state } = stateOf(source);
  return schemaDiagnostics(state, schema).map((d) => ({
    text: state.sliceDoc(d.from, d.to),
    message: d.message,
    severity: d.severity,
  }));
}

async function complete(source: string): Promise<string[]> {
  const { state, pos } = stateOf(source);
  const result = await schemaCompletionSource(schema)(new CompletionContext(state, pos, true));
  return result ? result.options.map((o) => o.label) : [];
}

/**
 * Accepts the completion `label` the way @codemirror/autocomplete does: it filters options by the text
 * from `from` to `to ?? cursor` (so that text must lead the label), then runs `apply` on the editor.
 */
async function accept(source: string, label: string): Promise<string> {
  const { state, pos } = stateOf(source);
  const result = await schemaCompletionSource(schema)(new CompletionContext(state, pos, true));
  if (!result) throw new Error('no completions');
  const option = result.options.find((o) => o.label === label);
  if (!option) throw new Error(`no option ${label}`);
  const to = result.to ?? pos;
  expect(label.startsWith(state.sliceDoc(result.from, to)), 'the filter text leads the label').toBe(true);
  const view = new EditorView({ state });
  if (typeof option.apply === 'function') option.apply(view, option, result.from, to);
  else view.dispatch(insertCompletionText(view.state, option.apply ?? option.label, result.from, to));
  const doc = view.state.doc.toString();
  view.destroy();
  return doc;
}

describe('schemaDiagnostics', () => {
  it('is empty for a valid document and for text that does not parse', () => {
    expect(lint('{"uri": "/v1/*", "priority": 2}')).toEqual([]);
    expect(lint('{"uri": ')).toEqual([]);
  });

  it('marks a value of the wrong type', () => {
    expect(lint('{"uri": "/", "priority": "high"}')).toEqual([
      { text: '"high"', message: expect.stringMatching(/priority.*integer/) as unknown, severity: 'error' },
    ]);
  });

  it('marks an unknown property by its name', () => {
    expect(lint('{"uri": "/", "bogus": 1}')).toEqual([
      { text: '"bogus"', message: expect.stringContaining('bogus') as unknown, severity: 'error' },
    ]);
  });

  it('marks a missing required property at the start of its object', () => {
    expect(lint('{"priority": 1}')).toEqual([
      { text: '{', message: expect.stringContaining('uri') as unknown, severity: 'error' },
    ]);
  });

  it('follows $ref and array items', () => {
    expect(lint('{"uri": "/", "upstream": {"nodes": [{"host": "a", "port": "80"}]}}')).toEqual([
      { text: '"80"', message: expect.stringMatching(/upstream\/nodes\/0\/port.*integer/) as unknown, severity: 'error' },
    ]);
  });

  it('applies property defaults before if/then, as APISIX does, so a default that rules a branch out is not flagged', () => {
    const conditional: Obj = {
      type: 'object',
      properties: { policy: { type: 'string', default: 'local' } },
      if: { properties: { policy: { enum: ['redis'] } } },
      then: { required: ['redis_host'] },
    };
    const lintWith = (source: string) => schemaDiagnostics(stateOf(source).state, conditional).map((d) => d.message);
    expect(lintWith('{"count": 1}')).toEqual([]);
    expect(lintWith('{"policy": "redis"}')).toEqual([`must have required property 'redis_host'`]);
  });

  it('ignores a schema it cannot compile', () => {
    const { state } = stateOf('{"a": 1}');
    expect(schemaDiagnostics(state, { type: 'object', properties: { a: { type: 'no-such-type' } } })).toEqual([]);
  });
});

describe('schemaCompletionSource', () => {
  it('offers the property names not yet used', async () => {
    expect(await complete('{"uri": "/", |}')).toEqual(['priority', 'status', 'enable_websocket', 'upstream', 'plugins']);
  });

  it('offers property names while a new key is being typed after a comma', async () => {
    expect(await complete('{\n  "uri": "/",\n  "p|"\n}')).toEqual(['priority', 'status', 'enable_websocket', 'upstream', 'plugins']);
  });

  it('offers property names inside an open key string, following $ref', async () => {
    expect(await complete('{"upstream": {"|"}}')).toEqual(['type', 'nodes']);
  });

  it('offers enum values and booleans for a value', async () => {
    expect(await complete('{"upstream": {"type": |}}')).toEqual(['"roundrobin"', '"chash"']);
    expect(await complete('{"status": |}')).toEqual(['0', '1']);
    expect(await complete('{"enable_websocket": |}')).toEqual(['true', 'false']);
  });

  it('completes a key typed with its quotes (as closeBrackets leaves it)', async () => {
    expect(await accept('{"uri": "/", "p|"}', 'priority')).toBe('{"uri": "/", "priority": }');
    expect(await accept('{"uri": "/", "st|": 1}', 'status')).toBe('{"uri": "/", "status": 1}');
  });

  it('completes a key typed without quotes, or with only the opening one', async () => {
    expect(await accept('{"uri": "/", pr|}', 'priority')).toBe('{"uri": "/", "priority": }');
    expect(await accept('{"uri": "/", "pr|}', 'priority')).toBe('{"uri": "/", "priority": }');
  });

  it('completes a key in the middle of its quotes, replacing the rest of it', async () => {
    expect(await accept('{"uri": "/", "pri|xx": 1}', 'priority')).toBe('{"uri": "/", "priority": 1}');
  });

  it('completes a value, replacing the literal under the cursor', async () => {
    expect(await accept('{"upstream": {"type": "ro|"}}', '"roundrobin"')).toBe('{"upstream": {"type": "roundrobin"}}');
    expect(await accept('{"upstream": {"type": |}}', '"chash"')).toBe('{"upstream": {"type": "chash"}}');
  });

  it('offers nothing where the schema says nothing', async () => {
    expect(await complete('{"plugins": {|}}')).toEqual([]);
  });
});
