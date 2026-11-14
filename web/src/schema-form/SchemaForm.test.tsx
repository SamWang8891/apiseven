import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { everySchema, schemaOf } from '../test/pluginFixture';
import { editableControls, renderSchemaForm } from '../test/schemaForm';

/** Fires one change on the first control that takes it (expanding a group when nothing is open). */
function changeOneField(container: HTMLElement, emitted: () => number): boolean {
  for (let round = 0; round < 4; round++) {
    const before = emitted();
    for (const el of container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
      fireEvent.change(el, { target: { value: '7' } });
      if (el.classList.contains('ui-tags__input')) {
        fireEvent.keyDown(el, { key: 'Enter' });
        // A list of enum members refuses '7' and names what it takes: type the first of those.
        const allowed = /Must be one of: ([^,]+)/.exec(el.closest('.ui-field')?.textContent ?? '')?.[1];
        if (emitted() === before && allowed) {
          fireEvent.change(el, { target: { value: allowed.trim() } });
          fireEvent.keyDown(el, { key: 'Enter' });
        }
      }
      if (emitted() > before) return true;
    }
    for (const trigger of container.querySelectorAll<HTMLElement>('[role="combobox"]')) {
      fireEvent.click(trigger);
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.getAttribute('aria-selected') !== 'true');
      if (option) fireEvent.click(option);
      if (emitted() > before) return true;
      fireEvent.keyDown(document.activeElement ?? trigger, { key: 'Escape' });
    }
    const closed = container.querySelector<HTMLElement>('button[aria-expanded="false"]');
    if (!closed) return false;
    fireEvent.click(closed);
  }
  return false;
}

describe('SchemaForm: every plugin schema in the fixture', () => {
  const all = everySchema().map((s) => [s.label, s.schema] as const);

  it.each(all)('%s renders with {} (Review Focus 2a)', (_label, schema) => {
    const form = renderSchemaForm(schema, {});
    expect(form.container.querySelector('.sf')).not.toBeNull();
    expect(form.changes).not.toHaveBeenCalled();
  });

  it.each(all)('%s keeps a key it does not know through a field change (Review Focus 2b)', (_label, schema) => {
    const unknown = { a: [1] };
    const form = renderSchemaForm(schema, { __unknown: unknown });
    expect(screen.getByText(/1 field not in the schema: __unknown/)).toBeInTheDocument();
    expect(changeOneField(form.container, () => form.changes.mock.calls.length), 'some field took a change').toBe(true);
    const last = form.value() as Obj;
    expect(last.__unknown).toEqual({ a: [1] });
    expect(Object.keys(last).length).toBeGreaterThan(1);
  });
});

describe('SchemaForm: real plugins', () => {
  it('limit-count: policy is a select of local, redis, redis-cluster; count is an integer field marked required', async () => {
    const form = renderSchemaForm(schemaOf('limit-count'), {});
    await form.user.click(screen.getByRole('combobox', { name: 'policy' }));
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(['local', 'redis', 'redis-cluster']));
    await form.user.keyboard('{Escape}');
    const count = screen.getByRole('textbox', { name: 'count (required)' });
    expect(screen.getByRole('textbox', { name: 'time_window (required)' })).toBeInTheDocument();
    await form.user.type(count, '10');
    expect(form.value()).toEqual({ count: 10 });
    // A variable is text: count also takes a string.
    await form.user.clear(count);
    await form.user.type(count, '$http_quota');
    expect(form.value()).toEqual({ count: '$http_quota' });
  });

  it('limit-count: the one-of hint names both ways; with rules, count is no longer required', () => {
    renderSchemaForm(schemaOf('limit-count'), { rules: [{ count: 1, time_window: 1, key: 'k' }] });
    expect(screen.getByText('Set one of: count + time_window or rules')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'count' })).toBeInTheDocument();
  });

  it('limit-count: choosing the redis policy brings in its fields, redis_host required', async () => {
    const form = renderSchemaForm(schemaOf('limit-count'), { count: 1, time_window: 60 });
    expect(screen.queryByRole('textbox', { name: /^redis_host/ })).toBeNull();
    await form.user.click(screen.getByRole('combobox', { name: 'policy' }));
    await form.user.click(screen.getByRole('option', { name: 'redis' }));
    expect(screen.getByText('When policy is redis')).toBeInTheDocument();
    const host = screen.getByRole('textbox', { name: 'redis_host (required)' });
    await form.user.type(host, '127.0.0.1');
    expect(form.value()).toEqual({ count: 1, time_window: 60, policy: 'redis', redis_host: '127.0.0.1' });
    expect(screen.getByLabelText(/^redis_password/)).toHaveAttribute('type', 'password');
  });

  it('proxy-rewrite: headers is a field of its own, so the plugin is a form, not JSON', async () => {
    const form = renderSchemaForm(schemaOf('proxy-rewrite'), {});
    expect(screen.getByRole('textbox', { name: 'uri' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/as JSON$/)).toBeNull();
    const headers = screen.getByRole('combobox', { name: 'headers' });
    expect(headers).toHaveTextContent('add, remove, set');
    // The documented example: set X-Api-Version, remove X-Unused.
    const set = screen.getByRole('group', { name: 'set' });
    await form.user.type(within(set).getByRole('textbox', { name: 'Key 1' }), 'X-Api-Version');
    await form.user.type(within(set).getByRole('textbox', { name: 'Value 1' }), 'v1');
    const remove = screen.getByRole('textbox', { name: 'remove' });
    await form.user.type(remove, 'X-Unused{Enter}');
    expect(form.value()).toEqual({ headers: { set: { 'X-Api-Version': 'v1' }, remove: ['X-Unused'] } });
  });

  it('proxy-rewrite: a plain map of headers shows as the map form, numbers kept as numbers', async () => {
    const form = renderSchemaForm(schemaOf('proxy-rewrite'), { headers: { 'X-A': 'a', 'X-N': 5 } });
    expect(screen.getByRole('combobox', { name: 'headers' })).toHaveTextContent('Key → value map');
    const second = screen.getByRole('textbox', { name: 'Value 1' });
    await form.user.type(second, '!');
    expect(form.value()).toEqual({ headers: { 'X-A': 'a!', 'X-N': 5 } });
  });

  it('key-auth consumer schema: key is a secret field', () => {
    renderSchemaForm(schemaOf('key-auth', 'consumer_schema'), {});
    const key = screen.getByLabelText(/^key\b/);
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toBeRequired();
  });

  it('jwt-auth consumer schema: an RS256 algorithm brings in a required public_key', async () => {
    const form = renderSchemaForm(schemaOf('jwt-auth', 'consumer_schema'), { key: 'k' });
    expect(screen.queryByLabelText(/^public_key/)).toBeNull();
    await form.user.click(screen.getByRole('combobox', { name: 'algorithm' }));
    await form.user.click(screen.getByRole('option', { name: 'RS256' }));
    expect(screen.getByLabelText(/^public_key/)).toBeRequired();
  });
});

describe('SchemaForm: values', () => {
  it('writes no defaults: a form with defaults emits nothing until edited; clearing a field deletes its key', async () => {
    const form = renderSchemaForm(schemaOf('limit-count'), { count: 2, time_window: 60 });
    expect(form.changes).not.toHaveBeenCalled();
    const code = screen.getByRole('spinbutton', { name: 'rejected_code' });
    expect(code).toHaveAttribute('placeholder', 'default: 503');
    await form.user.type(code, '429');
    expect(form.value()).toEqual({ count: 2, time_window: 60, rejected_code: 429 });
    await form.user.clear(code);
    expect(form.value()).toEqual({ count: 2, time_window: 60 });
    const group = screen.getByRole('textbox', { name: 'group' });
    await form.user.type(group, 'g');
    await form.user.clear(group);
    expect(form.value()).toEqual({ count: 2, time_window: 60 });
  });

  it('removes an object that becomes empty, unless it is required', async () => {
    const schema: Obj = {
      type: 'object',
      required: ['must'],
      properties: {
        redis: { type: 'object', properties: { host: { type: 'string' } } },
        must: { type: 'object', properties: { host: { type: 'string' } } },
      },
    };
    const form = renderSchemaForm(schema, { redis: { host: 'r' }, must: { host: 'm' } });
    const [redisHost, mustHost] = screen.getAllByRole('textbox', { name: 'host' });
    await form.user.clear(redisHost as HTMLElement);
    await form.user.clear(mustHost as HTMLElement);
    expect(form.value()).toEqual({ must: {} });
  });

  it('booleans are tri-state: unset emits nothing, On true, Off false, Reset removes the key', async () => {
    const schema: Obj = { type: 'object', properties: { flag: { type: 'boolean', default: false } } };
    const form = renderSchemaForm(schema, {});
    const select = screen.getByRole('combobox', { name: 'flag' });
    expect(select).toHaveTextContent('Default (Off)');
    expect(form.changes).not.toHaveBeenCalled();
    await form.user.click(select);
    await form.user.click(screen.getByRole('option', { name: 'On' }));
    expect(form.value()).toEqual({ flag: true });
    await form.user.click(screen.getByRole('switch', { name: 'flag' }));
    expect(form.value()).toEqual({ flag: false });
    await form.user.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(form.value()).toEqual({});
    await form.user.click(screen.getByRole('combobox', { name: 'flag' }));
    await form.user.click(screen.getByRole('option', { name: 'Off' }));
    expect(form.value()).toEqual({ flag: false });
  });

  it('a ["string","integer"] property round-trips "5m" as a string and 30 as a number', async () => {
    const schema: Obj = { type: 'object', properties: { ttl: { type: ['string', 'integer'] } } };
    const form = renderSchemaForm(schema, { ttl: 30 });
    const ttl = screen.getByRole('textbox', { name: 'ttl' });
    expect(ttl).toHaveValue('30');
    await form.user.clear(ttl);
    await form.user.type(ttl, '5m');
    expect(form.value()).toEqual({ ttl: '5m' });
    await form.user.clear(ttl);
    await form.user.type(ttl, '30');
    expect(form.value()).toEqual({ ttl: 30 });
  });

  describe('variants', () => {
    const schema: Obj = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        target: {
          oneOf: [
            { type: 'object', title: 'Upstream', properties: { kind: { const: 'upstream' }, host: { type: 'string' }, timeout: { type: 'integer' } } },
            { type: 'object', title: 'Service', properties: { kind: { const: 'service' }, service_id: { type: 'string' }, timeout: { type: 'integer' } } },
          ],
        },
      },
    };

    it('switching keeps the keys both options have and drops the rest', async () => {
      const form = renderSchemaForm(schema, { target: { kind: 'upstream', host: 'h', timeout: 5 } });
      const picker = screen.getByRole('combobox', { name: 'target' });
      expect(picker).toHaveTextContent('Upstream');
      await form.user.click(picker);
      await form.user.click(screen.getByRole('option', { name: 'Service' }));
      expect(form.value()).toEqual({ target: { timeout: 5, kind: 'service' } });
      expect(screen.getByRole('textbox', { name: 'service_id' })).toBeInTheDocument();
    });

    it('a value that matches no option is shown as JSON and emitted unchanged', async () => {
      const odd = { kind: 'other', x: [1, 2] };
      const form = renderSchemaForm(schema, { target: odd });
      expect(screen.queryByRole('combobox', { name: 'target' })).toBeNull();
      expect(await screen.findByLabelText('target as JSON')).toBeInTheDocument();
      expect(screen.getByText(/doesn't match any of the forms/)).toBeInTheDocument();
      await form.user.type(screen.getByRole('textbox', { name: 'name' }), 'n');
      expect(form.value()).toEqual({ target: odd, name: 'n' });
      expect((form.value() as Obj).target).toBe(odd);
    });
  });

  describe('arrays of objects', () => {
    const item = { type: 'object', properties: { host: { type: 'string' }, port: { type: 'integer' } } };
    const schema: Obj = {
      type: 'object',
      required: ['kept'],
      properties: { nodes: { type: 'array', items: item }, kept: { type: 'array', items: item } },
    };
    const list = (name: string) => within(screen.getByRole('group', { name: new RegExp(`^${name}\\b`) }));

    it('adds, moves up and down, and removes items', async () => {
      const form = renderSchemaForm(schema, { nodes: [{ host: 'a' }, { host: 'b' }] });
      await form.user.click(list('nodes').getByRole('button', { name: 'Add to nodes' }));
      expect(form.value()).toEqual({ nodes: [{ host: 'a' }, { host: 'b' }, {}] });
      await form.user.click(list('nodes').getByRole('button', { name: 'Move item 2 up' }));
      expect(form.value()).toEqual({ nodes: [{ host: 'b' }, { host: 'a' }, {}] });
      await form.user.click(list('nodes').getByRole('button', { name: 'Move item 1 down' }));
      expect(form.value()).toEqual({ nodes: [{ host: 'a' }, { host: 'b' }, {}] });
      await form.user.click(list('nodes').getByRole('button', { name: 'Remove item 1' }));
      expect(form.value()).toEqual({ nodes: [{ host: 'b' }, {}] });
      // Typing goes to the item it belongs to after the reorder.
      await form.user.type(list('nodes').getAllByRole('textbox', { name: 'host' })[1] as HTMLElement, 'c');
      expect(form.value()).toEqual({ nodes: [{ host: 'b' }, { host: 'c' }] });
    });

    it('removing the last item deletes the key, unless the list is required', async () => {
      const form = renderSchemaForm(schema, { nodes: [{ host: 'a' }], kept: [{ host: 'k' }] });
      await form.user.click(list('nodes').getByRole('button', { name: 'Remove item 1' }));
      await form.user.click(list('kept').getByRole('button', { name: 'Remove item 1' }));
      expect(form.value()).toEqual({ kept: [] });
    });
  });

  it('a map with non-string values round-trips: edit, rename, add, remove', async () => {
    const schema: Obj = { type: 'object', properties: { weights: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } } } };
    const form = renderSchemaForm(schema, { weights: { 'a:80': 1, 'b:80': 2 } });
    expect(form.changes).not.toHaveBeenCalled();
    const a = screen.getByRole('spinbutton', { name: 'Value of a:80' });
    await form.user.clear(a);
    await form.user.type(a, '5');
    expect(form.value()).toEqual({ weights: { 'a:80': 5, 'b:80': 2 } });
    const key = screen.getByRole('textbox', { name: 'Key of entry 2' });
    await form.user.clear(key);
    await form.user.type(key, 'c:80');
    await form.user.tab();
    expect(form.value()).toEqual({ weights: { 'a:80': 5, 'c:80': 2 } });
    await form.user.click(screen.getByRole('button', { name: 'Add entry' }));
    expect(screen.getByRole('spinbutton', { name: 'Value of entry 3' })).toBeInTheDocument();
    await form.user.type(screen.getByRole('textbox', { name: 'Key of entry 3' }), 'd:80');
    expect(form.value()).toEqual({ weights: { 'a:80': 5, 'c:80': 2 } });
    await form.user.type(screen.getByRole('spinbutton', { name: 'Value of d:80' }), '7');
    expect(form.value()).toEqual({ weights: { 'a:80': 5, 'c:80': 2, 'd:80': 7 } });
    await form.user.click(screen.getByRole('button', { name: 'Remove a:80' }));
    expect(form.value()).toEqual({ weights: { 'c:80': 2, 'd:80': 7 } });
  });

  it('lists the keys it does not know in a note and keeps them through edits', async () => {
    const schema: Obj = { type: 'object', properties: { name: { type: 'string' } } };
    const form = renderSchemaForm(schema, { extra: { deep: [1] }, other: 2 });
    expect(screen.getByText('2 fields not in the schema: extra, other — edit them in JSON.')).toBeInTheDocument();
    await form.user.type(screen.getByRole('textbox', { name: 'name' }), 'x');
    expect(form.value()).toEqual({ extra: { deep: [1] }, other: 2, name: 'x' });
  });
});

describe('SchemaForm: JSON fallback, ids, secrets, hidden fields', () => {
  it('keeps text that does not parse in the JSON editor, with an error, and does not emit it', async () => {
    const schema: Obj = { type: 'object', properties: { filter: { type: 'array' }, name: { type: 'string' } } };
    const form = renderSchemaForm(schema, { filter: [['a', '==', 1]] });
    const editor = await screen.findByRole('textbox', { name: 'filter as JSON' });
    await form.user.click(editor);
    await form.user.keyboard('{Control>}a{/Control}');
    await form.user.paste('[["b", "==", 2]');
    expect(await screen.findByText(/^Not valid JSON/)).toBeInTheDocument();
    expect(form.changes).not.toHaveBeenCalled();
    await form.user.keyboard('{Control>}a{/Control}');
    await form.user.paste('[["b", "==", 2]]');
    expect(form.value()).toEqual({ filter: [['b', '==', 2]] });
    expect(screen.queryByText(/^Not valid JSON/)).toBeNull();
  });

  it('names field ids after idPrefix and the dotted path', () => {
    const schema: Obj = { type: 'object', properties: { redis: { type: 'object', properties: { host: { type: 'string' } } } } };
    renderSchemaForm(schema, { redis: { host: 'h' } }, { idPrefix: 'p1' });
    expect(screen.getByRole('textbox', { name: 'host' })).toHaveAttribute('id', 'p1-redis.host');
  });

  it('masks fields named in encryptFields, beside the schema own encrypt_fields', () => {
    renderSchemaForm(schemaOf('limit-count'), { count: 1, time_window: 1 }, { encryptFields: ['group'] });
    expect(screen.getByLabelText(/^group\b/)).toHaveAttribute('type', 'password');
  });

  it('names keys that only another setting would show, and keeps them', async () => {
    const form = renderSchemaForm(schemaOf('limit-count'), { count: 1, time_window: 1, redis_host: 'r' });
    expect(screen.getByText('1 field not used with the current settings: redis_host — kept as it is; edit it in JSON.')).toBeInTheDocument();
    await form.user.type(screen.getByRole('textbox', { name: 'group' }), 'g');
    expect(form.value()).toEqual({ count: 1, time_window: 1, redis_host: 'r', group: 'g' });
  });
});

describe('SchemaForm: secrets and stored entries (review fix round 1)', () => {
  it('redacts the secret inside a locked JSON fallback (openfunction authorization.service_token), with a reveal', async () => {
    const value = { function_uri: 'http://fn.example', authorization: { service_token: 'tok-123' } };
    const form = renderSchemaForm(schemaOf('openfunction'), value, { locked: true });
    expect(form.container.textContent).not.toContain('tok-123');
    expect(form.container.textContent).toContain('service_token');
    const reveal = screen.getByRole('button', { name: 'Show value' });
    await form.user.click(reveal);
    expect(form.container.textContent).toContain('tok-123');
    await form.user.click(screen.getByRole('button', { name: 'Hide value' }));
    expect(form.container.textContent).not.toContain('tok-123');
  });

  it('redacts, at any depth of a locked JSON fallback, encrypt paths and secret-named keys, and nothing else', () => {
    const schema: Obj = {
      type: 'object',
      properties: { blob: { type: 'object', additionalProperties: false }, rules: { type: 'array' }, client_secret: { type: 'string' } },
    };
    const value = {
      blob: { inner: 'hidden-1', other: 'shown-1' },
      rules: [{ password: 'hidden-2', name: 'shown-2' }, ['x', { api_token: 'hidden-3' }]],
      client_secret: { nested: 'hidden-4' },
    };
    const form = renderSchemaForm(schema, value, { locked: true, encryptFields: ['blob.inner'] });
    const text = form.container.textContent;
    for (const hidden of ['hidden-1', 'hidden-2', 'hidden-3', 'hidden-4']) expect(text).not.toContain(hidden);
    for (const shown of ['shown-1', 'shown-2', 'other', 'api_token']) expect(text).toContain(shown);
  });

  it('shows the JSON in clear while editing', async () => {
    renderSchemaForm(schemaOf('openfunction'), { authorization: { service_token: 'tok-123' } });
    expect((await screen.findByRole('textbox', { name: 'authorization as JSON' })).textContent).toContain('tok-123');
  });

  it('never prints a secret in a list card header, locked or not', () => {
    const schema: Obj = {
      type: 'object',
      properties: { nodes: { type: 'array', items: { type: 'object', properties: { host: { type: 'string' }, password: { type: 'string' }, apikey: { type: 'string' } } } } },
    };
    const value = { nodes: [{ host: 'h1', password: 'p1', apikey: 'k1' }] };
    for (const locked of [false, true]) {
      const form = renderSchemaForm(schema, value, { locked, encryptFields: ['nodes.apikey'] });
      const summary = form.container.querySelector('.sf-card__summary')?.textContent ?? '';
      expect(summary).toContain('host=h1');
      expect(summary).not.toContain('p1');
      expect(summary).not.toContain('k1');
      form.unmount();
    }
  });

  it('keeps a stored map entry whose key fails the pattern through an edit of another entry', async () => {
    const schema: Obj = { type: 'object', properties: { weights: { type: 'object', patternProperties: { '^[a-z0-9:]+$': { type: 'integer' } } } } };
    const form = renderSchemaForm(schema, { weights: { 'Bad Key': 1, good: 2 } });
    expect(screen.getByText(/Key "Bad Key" must match/)).toBeInTheDocument();
    const good = screen.getByRole('spinbutton', { name: 'Value of good' });
    await form.user.clear(good);
    await form.user.type(good, '5');
    expect(form.value()).toEqual({ weights: { 'Bad Key': 1, good: 5 } });
  });

  it('renaming a map key to one already stored keeps the stored entry', async () => {
    const schema: Obj = { type: 'object', properties: { weights: { type: 'object', additionalProperties: { type: 'integer' } } } };
    const form = renderSchemaForm(schema, { weights: { a: 1, b: 2 } });
    const key = screen.getByRole('textbox', { name: 'Key of entry 1' });
    await form.user.clear(key);
    await form.user.type(key, 'b');
    expect(form.value()).toEqual({ weights: { b: 2 } });
    await form.user.type(key, 'c');
    expect(form.value()).toEqual({ weights: { bc: 1, b: 2 } });
  });

  it('keeps each stored tag as it was, even two that read the same (1 and "1")', async () => {
    const schema: Obj = { type: 'object', properties: { ids: { type: 'array', items: { type: ['string', 'integer'] } } } };
    const form = renderSchemaForm(schema, { ids: [1, '1'] });
    await form.user.type(screen.getByRole('textbox', { name: 'ids' }), 'x{Enter}');
    expect(form.value()).toEqual({ ids: [1, '1', 'x'] });
  });
});

describe('SchemaForm: errors', () => {
  const schema: Obj = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      redis: { type: 'object', properties: { host: { type: 'string' }, port: { type: 'integer' } } },
      rules: { type: 'array', items: { type: 'object', properties: { match: { type: 'array' }, id: { type: 'string' } } } },
    },
  };

  it('shows an error on the field at its path', () => {
    renderSchemaForm(schema, { redis: { host: 'x' } }, { errors: [{ path: 'redis.host', message: 'bad host' }] });
    expect(screen.getByRole('textbox', { name: 'host' })).toHaveAccessibleDescription('bad host');
  });

  it('opens a collapsed group that holds an error', () => {
    const form = renderSchemaForm(schema, {});
    expect(screen.queryByRole('textbox', { name: 'host' })).toBeNull();
    act(() => form.update({ errors: [{ path: 'redis.host', message: 'needed' }] }));
    expect(screen.getByRole('textbox', { name: 'host' })).toHaveAccessibleDescription('needed');
  });

  it('shows an error on a path the form does not render on the nearest field that is rendered', () => {
    renderSchemaForm(schema, { rules: [{ match: [1, 2, 3] }] }, {
      errors: [
        { path: 'rules.0.match.2', message: 'bad match' },
        { path: 'nope.deeper', message: 'about nope' },
        { path: '', message: 'about the whole' },
      ],
    });
    const match = screen.getByText('bad match').closest('.ui-field');
    expect(match?.textContent).toContain('match');
    const root = screen.getByRole('alert');
    expect(root).toHaveTextContent('about nope');
    expect(root).toHaveTextContent('about the whole');
  });
});

describe('SchemaForm: locked', () => {
  const samples: [string, string, Obj][] = [
    ['limit-count', 'schema', { count: 2, time_window: 60, rejected_code: 429, policy: 'redis', redis_host: '127.0.0.1', show_limit_quota_header: false }],
    ['proxy-rewrite', 'schema', { uri: '/v2/get', headers: { set: { 'X-Api-Version': 'v1' }, remove: ['X-Unused'] }, method: 'GET' }],
    ['cors', 'schema', { allow_origins: 'https://a.example', allow_methods: 'GET,POST', max_age: 3600, allow_credential: true }],
    ['ip-restriction', 'schema', { whitelist: ['127.0.0.1', '10.0.0.0/8'], message: 'Blocked' }],
    ['openid-connect', 'schema', { client_id: 'c', client_secret: 's', discovery: 'https://idp/.well-known', bearer_only: true, session: { secret: 'x'.repeat(16) } }],
    ['kafka-logger', 'schema', { brokers: [{ host: '127.0.0.1', port: 9092 }], kafka_topic: 'logs', batch_max_size: 1, log_format: { host: '$host' } }],
    ['response-rewrite', 'schema', { status_code: 200, body: '{"ok":true}', headers: { set: { 'X-A': '1' } }, vars: [['status', '==', 500]] }],
    ['traffic-split', 'schema', { rules: [{ match: [{ vars: [['arg_name', '==', 'jack']] }], weighted_upstreams: [{ upstream: { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } }, weight: 3 }, { weight: 1 }] }] }],
    ['key-auth', 'consumer_schema', { key: 'secret-key' }],
    ['prometheus', 'metadata_schema', { disabled_labels: { http_status: ['route', 'node'] } }],
  ];

  it.each(samples)('%s (%s) renders no control a value could be typed into', (plugin, kind, value) => {
    const form = renderSchemaForm(schemaOf(plugin, kind as 'schema'), value, { locked: true });
    expect(editableControls(form.container)).toEqual([]);
    expect(form.container.textContent).not.toBe('');
  });

  it('shows values as text and hides secrets behind a reveal', () => {
    renderSchemaForm(schemaOf('key-auth', 'consumer_schema'), { key: 'secret-key' }, { locked: true });
    expect(screen.queryByText('secret-key')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show value' })).toBeInTheDocument();
  });

  it('hides Add, Remove, Move and Reset', () => {
    const schema: Obj = { type: 'object', properties: { list: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } }, flag: { type: 'boolean' } } };
    renderSchemaForm(schema, { list: [{ a: 'x' }, { a: 'y' }], flag: true }, { locked: true });
    expect(screen.queryByRole('button', { name: /Add|Remove|Move|Reset/ })).toBeNull();
  });
});

describe('SchemaForm: performance', () => {
  it('mounts fewer than 400 controls for openid-connect with {} (collapsed groups are not mounted)', () => {
    const form = renderSchemaForm(schemaOf('openid-connect'), {});
    const controls = form.container.querySelectorAll('input, textarea, select, button');
    expect(controls.length).toBeGreaterThan(20);
    expect(controls.length).toBeLessThan(400);
  });
});

describe('SchemaForm: hostile schemas', () => {
  const selfish: Obj = { type: 'object', properties: {} };
  (selfish.properties as Obj).me = selfish;
  it.each<[string, unknown]>([
    ['circular $ref', { type: 'object', properties: { self: { $ref: '#' } } }],
    ['self-containing object', selfish],
    ['properties: null', { type: 'object', properties: null }],
    ['type: 5', { type: 5 }],
    ['items: []', { type: 'object', properties: { a: { type: 'array', items: [] } } }],
    ['enum: {}', { type: 'object', properties: { a: { enum: {} } } }],
  ])('%s renders without throwing', (_name, schema) => {
    expect(() => renderSchemaForm(schema as Obj, { a: 1 })).not.toThrow();
  });
});
