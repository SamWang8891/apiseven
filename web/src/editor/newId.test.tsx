// A new object's id is the frame's to refuse (fix round 1, R4): missing, refused by the kind's id rule
// (a consumer's username too), or not one path segment once nginx decodes it (a slash, `.`, `..`).
// Such a draft is never sent: not by Save, not by Save anyway, which is not offered for it.
import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { consumerIssues } from '../resources/consumers/validate';
import type { ValidateEnv } from '../resources/registry';
import { secretIdProblem } from '../resources/secrets/validate';
import { resetApp } from '../test/app';
import { GENERAL_TAB, main, openEditor, overrideDef, writesOf } from '../test/editor';
import { pluginReplies } from '../test/plugins';
import { getToasts } from '../ui/toast';
import { ApiError } from '../api/errors';
import { saveFailure } from './failure';
import { newIdState, segmentProblem } from './newId';

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
  resetApp();
  resetReadOnlyKeys();
});

const STRICT = 'a local check that refuses this draft';
const offerButton = () => main().queryByRole('button', { name: t('editor.anyway.action') });

describe('segmentProblem and newIdState', () => {
  it('an id that would not stay one path segment', () => {
    for (const id of ['a/b', '.', '..', '/', 'x/..']) expect(segmentProblem(id), id).toBe(t('editor.id.segment', { id }));
    for (const id of ['a.b', '..a', 'a..', 'r1', 'a-b_c']) expect(segmentProblem(id), id).toBeUndefined();
    // A kind whose ids hold one slash: each segment is checked.
    expect(segmentProblem('vault/my-id', true)).toBeUndefined();
    expect(segmentProblem('vault/..', true)).toBe(t('editor.id.segment', { id: 'vault/..' }));
  });

  it("a secret's name can't be . or .. either", () => {
    expect(secretIdProblem('vault/..')).toBe(t('editor.id.segment', { id: 'vault/..' }));
    expect(secretIdProblem('vault/.')).toBe(t('editor.id.segment', { id: 'vault/.' }));
    expect(secretIdProblem('vault/my-id')).toBeUndefined();
  });

  it('a consumer: a missing username is missing, a refused one is refused', () => {
    const consumer = { idMode: 'required' as const, idFromDraft: (d: Obj) => (typeof d.username === 'string' && d.username !== '' ? d.username : undefined), idProblem: (id: string) => (/^[\w-]+$/.test(id) ? undefined : 'bad') };
    expect(newIdState(consumer, {}, { isNew: true, newId: '' })).toMatchObject({ createId: undefined, missing: true });
    expect(newIdState(consumer, { username: 'a/b' }, { isNew: true, newId: '' })).toMatchObject({ createId: 'a/b', refused: 'bad' });
    // A stored object's id is not judged.
    expect(newIdState(consumer, { username: 'a/b' }, { isNew: false, newId: '' })).toMatchObject({ missing: false, refused: undefined });
  });
});

describe('the API client is the last line (fix round 2, R4)', () => {
  it("a write it refused is named as not sent, not as APISIX's refusal", () => {
    const error = new ApiError('refused', 'nothing sent', { status: 404, errorMsg: '"a/b" can’t be an ID' });
    expect(saveFailure(error)).toEqual({ title: t('editor.notSent'), message: '"a/b" can’t be an ID' });
    expect(saveFailure(new ApiError('http', 'HTTP 400', { status: 400, errorMsg: 'bad' }), 'uri')).toEqual({ message: 'bad', path: 'uri' });
  });
});

describe('a consumer whose username is not an id: no request, and no Save anyway, beside another local issue', () => {
  it.each([
    ['empty', ''],
    ['with a slash', 'a/b'],
    ['..', '..'],
  ])('%s', async (_, username) => {
    undo.push(overrideDef('consumers', { validate: (d: Obj, env: ValidateEnv) => [...consumerIssues(d, env), { path: 'desc', message: STRICT }] }));
    const { user, admin } = await openEditor('#/consumers/new', { objects: { consumers: [] }, replies: pluginReplies() });
    const field = await main().findByRole('textbox', { name: /^Username/ });
    if (username !== '') await user.type(field, username);
    const before = getToasts().length;
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(getToasts().length).toBe(before + 2));
    for (const toast of getToasts().slice(before)) expect(toast.message).not.toContain(t('editor.anyway.action'));
    expect(offerButton()).toBeNull();
    expect(writesOf(admin)).toEqual([]);
  });
});

describe('a typed id that is not one path segment (routes)', () => {
  it.each([
    ['a slash', 'a/b'],
    ['..', '..'],
  ])('%s: a plain Create is refused, the ID field says why; with a local issue too, no Save anyway (the idRefused exclusion)', async (_, id) => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB], validate: (d) => (d.name === 'strict' ? [{ path: 'name', message: STRICT }] : []) }));
    const { user, admin } = await openEditor('#/routes/new?upstream_id=u1', { objects: { routes: [], upstreams: [{ id: 'u1', name: 'pool', type: 'roundrobin', nodes: [] }] } });
    const idField = await main().findByRole('textbox', { name: 'ID' });
    await user.type(idField, id);
    expect(idField).toHaveAccessibleDescription(expect.stringContaining(t('editor.id.segment', { id })) as string);
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: t('editor.id.segment', { id }) })));
    expect(writesOf(admin)).toEqual([]);
    await user.type(main().getByRole('textbox', { name: 'Name' }), 'strict');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixMany', { count: 2 }), message: t('editor.id.segment', { id }) })));
    expect(offerButton()).toBeNull();
    expect(writesOf(admin)).toEqual([]);
  });
});
