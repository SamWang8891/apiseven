// Protos at page level, on a fake Admin API: the Content tab (an upload of .proto source fills the
// content; a compiled descriptor set is stored as base64 and shown as one; a refused file changes
// nothing), what Save sends, APISIX's delete refusal, and the list's size and used-by columns.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { sortItems } from '../../table/sort';
import { resetApp } from '../../test/app';
import { ctxOf, itemOf } from '../../test/ctx';
import { main, openEditor, writesOf } from '../../test/editor';
import { json } from '../../test/fakeAdmin';
import { editableControls } from '../../test/schemaForm';
import { protoColumns } from './columns';
import { decodedSize, formatBytes, isDescriptorSet, toBase64 } from './content';

beforeAll(async () => {
  await import('./bodies');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const SOURCE = 'syntax = "proto3";\npackage hello;\nservice Greeter {\n  rpc SayHello (Req) returns (Res) {}\n}\nmessage Req { string name = 1; }\nmessage Res { string message = 1; }\n';
/** A FileDescriptorSet as protoc writes it: field 1 (file), its name, and a package (a control byte, 0x12). */
const DESCRIPTOR = new Uint8Array([0x0a, 0x0f, 0x0a, 0x07, ...new TextEncoder().encode('a.proto'), 0x12, 0x04, ...new TextEncoder().encode('demo')]);
const HELLO: Obj = { id: 'hello', name: 'hello', desc: 'Greeter', content: SOURCE, x_future: 1, create_time: 1700000000, update_time: 1700000100 };

const open = (hash: string, protos: Obj[] = [HELLO], extra: Obj = {}) => openEditor(hash, { objects: { protos, routes: [], services: [], ...extra } });
const save = (user: UserEvent) => user.click(main().getByRole('button', { name: /^(Save|Create)/ }));
const fileInput = () => screen.getByRole('main').querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
const editor = () => main().findByRole('textbox', { name: t('pr.content.label') });

async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading')).toBeNull());
  return panel;
}

describe('the Content tab', () => {
  it('an uploaded .proto text file fills `content`, and Create sends exactly it', async () => {
    const { user, admin } = await open('#/protos/new?tab=content', []);
    await settled();
    await user.upload(fileInput(), new File([SOURCE], 'hello.proto', { type: 'text/plain' }));
    await waitFor(async () => expect((await editor()).textContent).toContain('package hello;'));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'POST', path: 'protos', body: { content: SOURCE } }]));
  });

  it('an uploaded compiled descriptor set is stored as base64 and shown as one, with Download; back to source on request', async () => {
    const { user, admin } = await open('#/protos/new?tab=content', []);
    await settled();
    await user.upload(fileInput(), new File([DESCRIPTOR], 'set.pb'));
    const summary = await main().findByText(t('pr.content.binary'));
    expect(summary.closest('.res-file')).toHaveTextContent(t('pr.content.binaryNote', { size: formatBytes(DESCRIPTOR.length) }));
    expect(main().queryByRole('textbox', { name: t('pr.content.label') })).not.toBeInTheDocument();
    expect(main().getByRole('button', { name: t('pr.content.download') })).toBeInTheDocument();
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'POST', path: 'protos', body: { content: toBase64(DESCRIPTOR) } }]));
    expect(isDescriptorSet(toBase64(DESCRIPTOR))).toBe(true);
    expect(decodedSize(toBase64(DESCRIPTOR))).toBe(DESCRIPTOR.length);
  });

  it('a refused file changes nothing and says why, without its content', async () => {
    const { user } = await open('#/protos/hello?tab=content');
    await main().findByRole('heading', { level: 1, name: 'hello' });
    await settled();
    await user.keyboard('e');
    await user.upload(fileInput(), new File([new Uint8Array([0x00, 0x01, 0x02, 0xff, 0x41])], 'junk.bin'));
    expect(await main().findByText(t('pr.file.notDescriptor'))).toBeInTheDocument();
    expect((await editor()).textContent).toContain('package hello;');
    expect(main().getByRole('button', { name: /^(Save)/ })).toBeInTheDocument();
    expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
  });

  it('what is typed is the content at once: Cmd/Ctrl-S right after a paste sends exactly it, with every other field as loaded', async () => {
    const { user, admin } = await open('#/protos/hello?tab=content');
    await main().findByRole('heading', { level: 1, name: 'hello' });
    await settled();
    await user.keyboard('e');
    const box = await editor();
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('syntax = "proto3";\npackage other;\n');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    const expected: Obj = { ...HELLO, content: 'syntax = "proto3";\npackage other;\n' };
    delete expected.create_time;
    delete expected.update_time;
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'protos/hello', body: expected }]));
  });

  it('emptied, the content is required: Save is refused on Content', async () => {
    const { user, admin } = await open('#/protos/hello?tab=content');
    await main().findByRole('heading', { level: 1, name: 'hello' });
    await settled();
    await user.keyboard('e');
    await user.click(await editor());
    await user.keyboard('{Control>}a{/Control}{Backspace}');
    await save(user);
    expect(writesOf(admin)).toEqual([]);
    expect(await main().findByText(t('pr.issue.content'))).toBeInTheDocument();
  });

  it('locked: no form controls; a stored descriptor set shows as one', async () => {
    await open('#/protos/compiled?tab=content', [{ id: 'compiled', content: toBase64(DESCRIPTOR) }]);
    await main().findByRole('heading', { level: 1, name: 'compiled' });
    const panel = await settled();
    expect(await within(panel).findByText(t('pr.content.binary'))).toBeInTheDocument();
    expect(editableControls(panel)).toEqual([]);
    expect(within(panel).queryByRole('button', { name: t('pr.content.replace') })).not.toBeInTheDocument();
  });
});

describe('a proto', () => {
  it('a save from General sends the content and every other field as loaded', async () => {
    const { user, admin } = await open('#/protos/hello');
    await main().findByRole('heading', { level: 1, name: 'hello' });
    await settled();
    await user.keyboard('e');
    await user.type(main().getByRole('textbox', { name: t('pr.general.desc') }), '!');
    await save(user);
    const expected: Obj = { ...HELLO, desc: 'Greeter!' };
    delete expected.create_time;
    delete expected.update_time;
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'protos/hello', body: expected }]));
  });

  it('Create with a typed id that exists is refused, and the stored proto is unchanged', async () => {
    const { user, admin } = await open('#/protos/new?tab=content');
    await settled();
    await user.type(main().getByRole('textbox', { name: /^ID/ }), 'hello');
    await user.upload(fileInput(), new File([SOURCE], 'other.proto'));
    await waitFor(async () => expect((await editor()).textContent).toContain('package hello;'));
    await save(user);
    expect(await main().findByRole('alert')).toHaveTextContent(t('editor.taken.message', { kind: t('kind.protos.singular'), id: 'hello' }));
    expect(writesOf(admin)).toEqual([]);
    expect(admin.stored('protos')).toEqual([HELLO]);
  });

  it("Delete lists what uses it, and shows APISIX's refusal verbatim", async () => {
    const refusal = 'can not delete this proto, route [g1] is still using it now';
    const route: Obj = { id: 'g1', name: 'greeter', uri: '/g', plugins: { 'grpc-transcode': { proto_id: 'hello', service: 'hello.Greeter', method: 'SayHello' } } };
    const { user } = await openEditor('#/protos/hello', {
      objects: { protos: [HELLO], routes: [route], services: [] },
      replies: { 'protos/hello': (req) => (req.method === 'DELETE' ? json(400, { error_msg: refusal }) : undefined) },
    });
    await main().findByRole('heading', { level: 1, name: 'hello' });
    await user.click(main().getByRole('button', { name: t('editor.more') }));
    await user.click(await screen.findByRole('menuitem', { name: t('action.delete') }));
    const dialog = await screen.findByRole('alertdialog');
    expect(await within(dialog).findByRole('link', { name: /greeter/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('delete.confirm', { kind: t('kind.protos.singular') }) }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(refusal);
  });
});

describe('the protos list columns', () => {
  const col = (id: string) => {
    const column = protoColumns.find((c) => c.id === id);
    if (!column) throw new Error(id);
    return column;
  };
  const SMALL = itemOf('s', { content: 'syntax = "proto3";' });
  const BIG = itemOf('b', { content: SOURCE.repeat(40) });
  const WIDE = itemOf('w', { content: 'é'.repeat(30) });

  it('name, id, size, used by and updated by default', () => {
    expect(protoColumns.filter((c) => c.defaultVisible).map((c) => c.id)).toEqual(['name', 'id', 'size', 'used_by', 'updated']);
  });

  it('size: the bytes of the content (UTF-8), sorted as a number, shown for people', () => {
    expect(col('size').accessor(WIDE, ctxOf())).toBe(60);
    expect(sortItems([SMALL, BIG, WIDE], [{ id: 'size', desc: true }], protoColumns, ctxOf()).map((i) => i.id)).toEqual(['b', 'w', 's']);
    expect(sortItems([BIG, SMALL, WIDE], [{ id: 'size', desc: false }], protoColumns, ctxOf()).map((i) => i.id)).toEqual(['s', 'w', 'b']);
    expect(formatBytes(60)).toBe('60 B');
    expect(formatBytes(15 * 1024)).toBe('15 KB');
  });

  it("used by: routes and services (what APISIX's delete check sees) and the other objects whose grpc-transcode names it; nothing until every list has loaded", () => {
    const uses = (id: string) => ({ plugins: { 'grpc-transcode': { proto_id: id } } });
    const ctx = ctxOf({ routes: [itemOf('r1', uses('s'))], services: [itemOf('sv', uses('s'))], pluginConfigs: [itemOf('pc', uses('s'))], consumerGroups: [itemOf('cg', uses('b'))] });
    expect(col('used_by').accessor(SMALL, ctx)).toBe(3);
    expect(col('used_by').accessor(BIG, ctx)).toBe(1);
    expect(col('used_by').accessor(WIDE, ctx)).toBe(0);
    expect(col('used_by').accessor(SMALL, ctxOf({ ...ctx, loaded: { services: false } }))).toBeUndefined();
  });
});
