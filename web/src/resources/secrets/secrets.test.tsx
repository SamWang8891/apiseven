// Secret manager entries at page level, on a fake Admin API: the manager and id above the tabs
// ("vault/<id>", two path segments), the manager's form with its credentials masked, create never
// overwrites (an id with a slash included), a copy keeps the credentials and says so, the list never
// shows or finds a credential. And the three transcribed schemas, through SchemaForm.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { MASK } from '../../schema/secrets';
import { resetApp } from '../../test/app';
import { main, openEditor, writesOf } from '../../test/editor';
import { editableControls, renderSchemaForm } from '../../test/schemaForm';
import { getToasts } from '../../ui/toast';
import { MANAGERS, SCHEMAS } from './schemas';

beforeAll(async () => {
  await import('./bodies');
  await import('../../schema-form/SchemaForm');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const VAULT: Obj = { id: 'vault/v1', uri: 'http://127.0.0.1:8200', prefix: 'kv/apisix', token: 'hvs-stored-token', x_future: { kept: true } };
const AWS: Obj = { id: 'aws/a1', access_key_id: 'AKIA-STORED', secret_access_key: 'aws-stored-secret', region: 'eu-west-1' };

const open = (hash: string, stored: Obj[] = [VAULT, AWS]) => openEditor(hash, { objects: { secrets: stored } });
const create = (user: UserEvent) => user.click(main().getByRole('button', { name: t('editor.create') }));
const save = (user: UserEvent) => user.click(main().getByRole('button', { name: t('editor.save') }));

async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading')).toBeNull());
  return panel;
}

async function pickManager(user: UserEvent, label: string) {
  await user.click(main().getByRole('combobox', { name: /^Secret manager/ }));
  await user.click(await screen.findByRole('option', { name: new RegExp(`^${label}`) }));
}

const idBox = () => main().getByRole('textbox', { name: /^ID/ });

describe('a new secret', () => {
  it('saves to /secrets/vault/<id> with the manager picked and the id typed, and its token is masked', async () => {
    const { user, admin } = await open('#/secrets/new', []);
    await settled();
    expect(main().getByText(t('sc.config.choose'))).toBeInTheDocument();
    await pickManager(user, t('sc.manager.vault'));
    await user.type(idBox(), 'x');
    await settled();
    await user.type(await main().findByRole('textbox', { name: 'uri (required)' }), 'http://127.0.0.1:8200');
    await user.type(main().getByRole('textbox', { name: 'prefix (required)' }), 'kv/apisix');
    const token = main().getByLabelText(/^token/);
    expect(token).toHaveAttribute('type', 'password');
    await user.type(token, 'hvs-new-token');
    await create(user);
    await waitFor(() =>
      expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'secrets/vault/x', body: { uri: 'http://127.0.0.1:8200', prefix: 'kv/apisix', token: 'hvs-new-token' } }]),
    );
    await waitFor(() => expect(window.location.hash).toBe('#/secrets/vault%2Fx'));
    expect(await main().findByRole('heading', { level: 1, name: 'vault/x' })).toBeInTheDocument();
    await settled();
    await main().findByText('kv/apisix');
    // Locked: the token is masked until revealed.
    expect(screen.getByRole('main').textContent).not.toContain('hvs-new-token');
    await user.click(main().getByRole('button', { name: t('ui.secret.show') }));
    expect(main().getByText('hvs-new-token')).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: t('ui.secret.hide') }));
    expect(screen.getByRole('main').textContent).not.toContain('hvs-new-token');
  });

  it('switching to another manager asks, then starts the settings over: what is sent has none of the first manager’s', async () => {
    const { user, admin } = await open('#/secrets/new', []);
    await pickManager(user, t('sc.manager.vault'));
    await user.type(idBox(), 'x');
    await settled();
    await user.type(await main().findByRole('textbox', { name: 'uri (required)' }), 'http://vault:8200');
    await pickManager(user, t('sc.manager.aws'));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.switchId.title', { to: t('sc.manager.aws') }) });
    await user.click(within(dialog).getByRole('button', { name: t('editor.switchId.confirm') }));
    expect(idBox()).toHaveValue('x');
    await settled();
    expect(main().queryByRole('textbox', { name: 'uri (required)' })).not.toBeInTheDocument();
    await user.type(await main().findByLabelText(/^access_key_id/), 'AKIA1');
    await user.type(main().getByLabelText(/^secret_access_key/), 'sek');
    await create(user);
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'secrets/aws/x', body: { access_key_id: 'AKIA1', secret_access_key: 'sek' } }]));
  });

  it('an id with a slash is refused at once: Save and Cmd/Ctrl-S send nothing, and the toast names the ID', async () => {
    const { user, admin } = await open('#/secrets/new', []);
    await pickManager(user, t('sc.manager.vault'));
    await user.type(idBox(), 'a/b');
    expect(main().getByText(t('sc.id.slash', { id: 'a/b' }))).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await create(user);
    expect(writesOf(admin)).toEqual([]);
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixMany', { count: 4 }), message: t('sc.id.slash', { id: 'a/b' }) }));
    expect(idBox()).toHaveAttribute('aria-invalid', 'true');
  });

  it('Create never overwrites: an id that exists (with its slash) is refused, linked, and the stored entry is unchanged', async () => {
    const { user, admin } = await open('#/secrets/new');
    await pickManager(user, t('sc.manager.vault'));
    await user.type(idBox(), 'v1');
    await settled();
    await user.type(await main().findByRole('textbox', { name: 'uri (required)' }), 'http://other:8200');
    await user.type(main().getByRole('textbox', { name: 'prefix (required)' }), 'p');
    await user.type(main().getByLabelText(/^token/), 'other-token');
    await create(user);
    const banner = await main().findByRole('alert');
    expect(banner).toHaveTextContent(t('editor.taken.message', { kind: t('kind.secrets.singular'), id: 'vault/v1' }));
    expect(within(banner).getByRole('link', { name: t('editor.taken.open', { kind: t('kind.secrets.singular'), id: 'vault/v1' }) })).toHaveAttribute('href', '#/secrets/vault%2Fv1');
    expect(writesOf(admin)).toEqual([]);
    expect(admin.stored('secrets')[0]).toEqual(VAULT);
  });
});

describe('a stored secret', () => {
  it('opened locked: the manager as a badge, no form controls, the token masked; the prefix plugins use, with Copy', async () => {
    await open('#/secrets/vault%2Fv1');
    expect(await main().findByRole('heading', { level: 1, name: 'vault/v1' })).toBeInTheDocument();
    const panel = await settled();
    await within(panel).findByText('kv/apisix');
    expect(within(panel).getByText(t('sc.manager.vault'))).toBeInTheDocument();
    expect(editableControls(panel)).toEqual([]);
    expect(panel.textContent).not.toContain('hvs-stored-token');
    expect(within(panel).getByText('$secret://vault/v1/')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: t('sc.ref.copy') })).toBeInTheDocument();
  });

  it('editing: the token stays masked until revealed, and hides again after Save; a save sends it back unchanged with every other field', async () => {
    const { user, admin } = await open('#/secrets/vault%2Fv1');
    await main().findByRole('heading', { level: 1, name: 'vault/v1' });
    await settled();
    await user.keyboard('e');
    const token = await main().findByLabelText(/^token/);
    expect(token).toHaveAttribute('type', 'password');
    await user.click(main().getByRole('button', { name: t('ui.secret.show') }));
    expect(token).toHaveAttribute('type', 'text');
    await user.type(main().getByRole('textbox', { name: 'prefix (required)' }), '2');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'secrets/vault/v1', body: { ...VAULT, prefix: 'kv/apisix2' } }]));
    await main().findByRole('button', { name: t('editor.edit') });
    expect(screen.getByRole('main').textContent).not.toContain('hvs-stored-token');
    await user.keyboard('e');
    expect(await main().findByLabelText(/^token/)).toHaveAttribute('type', 'password');
  });

  it("a conflict's diff masks the credentials of both sides, marking a changed one", async () => {
    const { user, admin } = await open('#/secrets/vault%2Fv1');
    await main().findByRole('heading', { level: 1, name: 'vault/v1' });
    await settled();
    await user.keyboard('e');
    await user.type(await main().findByRole('textbox', { name: 'prefix (required)' }), '2');
    admin.touch('secrets', 'vault/v1', { token: 'hvs-their-token' });
    await save(user);
    const dialog = await screen.findByRole('dialog', { name: /changed/i });
    expect(dialog.textContent).not.toMatch(/hvs-stored-token|hvs-their-token/);
    expect(dialog.textContent).toContain(`${MASK} (changed)`);
  });

  it('an AWS entry masks its access key id too, locked and in the JSON tab', async () => {
    const { user } = await open('#/secrets/aws%2Fa1');
    await main().findByRole('heading', { level: 1, name: 'aws/a1' });
    const panel = await settled();
    await within(panel).findByText('eu-west-1');
    expect(panel.textContent).not.toMatch(/AKIA-STORED|aws-stored-secret/);
    await user.click(main().getByRole('tab', { name: new RegExp(`^${t('editor.json.tab')}`) }));
    const json = await screen.findByRole('textbox', { name: t('editor.json.label', { kind: t('kind.secrets.singular') }) });
    await waitFor(() => expect(json.textContent).toContain(MASK));
    expect(json.textContent).not.toMatch(/AKIA-STORED|aws-stored-secret/);
  });

  it('Duplicate keeps the manager and the credentials (masked) and says so; the copy is created under its own id', async () => {
    const { user, admin } = await open('#/secrets/new?from=vault%2Fv1');
    const notice = await main().findByRole('note', { name: t('editor.copyNotice.title') });
    expect(notice).toHaveTextContent(t('editor.copyNotice.credentials', { from: 'vault/v1', fields: 'token' }));
    expect(main().getByRole('combobox', { name: /^Secret manager/ })).toHaveTextContent(t('sc.manager.vault'));
    expect(idBox()).toHaveValue('');
    await settled();
    expect(await main().findByLabelText(/^token/)).toHaveAttribute('type', 'password');
    await user.type(idBox(), 'v2');
    await create(user);
    const copied = { ...VAULT };
    delete copied.id;
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'secrets/vault/v2', body: copied }]));
  });
});

describe('the secrets list', () => {
  it('links each id as manager/id to its editor, shows the manager and endpoint, never a credential; search finds nothing by one', async () => {
    const { user } = await openEditor('#/secrets', { objects: { secrets: [VAULT, AWS] } });
    const link = await main().findByRole('link', { name: 'vault/v1' });
    expect(link).toHaveAttribute('href', '#/secrets/vault%2Fv1');
    const row = link.closest('tr') as HTMLElement;
    expect(row).toHaveTextContent(t('sc.manager.vault'));
    expect(row).toHaveTextContent('http://127.0.0.1:8200');
    expect(screen.getByRole('main').textContent).not.toMatch(/hvs-stored-token|AKIA-STORED|aws-stored-secret/);
    const search = main().getByRole('searchbox', { name: t('table.search.label', { plural: t('kind.secrets.plural') }) });
    for (const secret of ['hvs-stored', 'AKIA-STORED', 'aws-stored-secret']) {
      await user.clear(search);
      await user.type(search, secret);
      await waitFor(() => expect(main().queryByRole('link', { name: /\/(v1|a1)$/ })).not.toBeInTheDocument());
    }
    await user.clear(search);
    await user.type(search, 'eu-west');
    expect(await main().findByRole('link', { name: 'aws/a1' })).toBeInTheDocument();
  });
});

describe('the manager schemas (transcribed from apisix/secret/*.lua)', () => {
  it.each(MANAGERS)('%s: every top-level property renders as a form field, none as a JSON fallback', async (manager) => {
    const schema = SCHEMAS[manager];
    renderSchemaForm(schema, {});
    for (const key of Object.keys(schema.properties as Obj)) {
      expect(screen.queryByRole('textbox', { name: new RegExp(`^${key}( \\(required\\))? as JSON$`) }), key).not.toBeInTheDocument();
      expect(await screen.findByText(key, { selector: 'label, label *, legend, legend *, button, button *, h3, h4, span' }), key).toBeInTheDocument();
    }
  });
});
