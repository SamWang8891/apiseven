// What a sign-in card says: revoke advice names only the field APISIX looks the entry up by
// (SIGN_IN_FIELD), never a secret that some configurations don't use; jwe-decrypt's wording says it
// decrypts; the run-options note claims "never runs" only where that holds.
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { pluginFixture } from '../test/pluginFixture';
import { SIGN_IN_FIELD, signInOf, type SignIn } from './auth';
import { runOptionsNote, signInBadge, signInNote } from './signInText';
import { AUTH_PLUGINS } from './subsystems';

const off = { _meta: { disable: true } };

describe('signInNote', () => {
  it('jwt-auth names its key as what to change, whatever the algorithm: never secret (RS256 checks public_key)', () => {
    for (const conf of [{ key: 'k', algorithm: 'RS256', public_key: 'P' }, { key: 'k', algorithm: 'HS256', secret: 's' }]) {
      for (const state of [conf, { ...conf, ...off }]) {
        const note = signInNote('jwt-auth', signInOf('jwt-auth', state));
        expect(note, JSON.stringify(state)).toContain('or change its key.');
        expect(note).not.toMatch(/\bsecret\b|public_key/);
      }
    }
  });

  it('jwe-decrypt: decrypts a token that names its key, "still used", never "signs in"', () => {
    const on = signInNote('jwe-decrypt', signInOf('jwe-decrypt', { key: 'k', secret: 's' }));
    expect(on).toBe(t('pl.card.signIn.noteDecrypt', { field: 'key' }));
    expect(on).toContain('decrypts a token whose kid names its key');
    const stored = signInOf('jwe-decrypt', { key: 'k', secret: 's', ...off });
    expect(signInNote('jwe-decrypt', stored)).toBe(t('pl.card.signIn.offNoteDecrypt', { field: 'key' }));
    expect(signInBadge('jwe-decrypt', stored.state).label).toBe(t('pl.card.signIn.stillUsed'));
    expect(signInBadge('jwe-decrypt', 'signsNobodyIn').label).toBe(t('pl.card.signIn.decryptsNothing'));
    for (const conf of [{ key: 'k', secret: 's' }, { key: 'k', secret: 's', ...off }, off]) {
      expect(signInNote('jwe-decrypt', signInOf('jwe-decrypt', conf))).not.toMatch(/signs? (?:in|nobody)/);
    }
  });

  it.each(AUTH_PLUGINS)('%s: every note names only fields its consumer schema has, and the one to change is SIGN_IN_FIELD', (name) => {
    const properties = Object.keys(pluginFixture().http[name]?.consumer_schema?.properties ?? {});
    // Every field any auth plugin's consumer schema has: a note may name one only if this plugin has it.
    const anyField = new Set(AUTH_PLUGINS.flatMap((p) => Object.keys(pluginFixture().http[p]?.consumer_schema?.properties ?? {})));
    const field = SIGN_IN_FIELD[name];
    const states: SignIn[] = [
      signInOf(name, {}),
      signInOf(name, off),
      ...(field ? [{ state: 'stillSignsIn' as const, field }, ...['password', 'secret_key', 'secret', 'public_key', field].map((missing) => ({ state: 'signsNobodyIn' as const, field, missing }))] : []),
    ].filter((s) => s.missing === undefined || properties.includes(s.missing));
    for (const state of states) {
      const note = signInNote(name, state);
      const named = [...anyField].filter((f) => new RegExp(`\\b${f}\\b`).test(note));
      for (const f of named) expect(properties, `${name} ${state.state}: "${note}" names ${f}`).toContain(f);
      const change = /or change its (\w+)\./.exec(note)?.[1];
      expect(change, `${name} ${state.state}`).toBe(state.state === 'signsNobodyIn' ? undefined : field);
    }
  });
});

describe('runOptionsNote', () => {
  it('"never runs" for any credential plugin and a built-in auth plugin of a consumer; a consumer\'s custom one may run other phases', () => {
    expect(runOptionsNote('credential', 'key-auth')).toBe(t('pl.meta.signInCredential', { name: 'key-auth' }));
    expect(runOptionsNote('credential', 'my-auth')).toBe(t('pl.meta.signInCredential', { name: 'my-auth' }));
    expect(runOptionsNote('consumer', 'basic-auth')).toBe(t('pl.meta.signInConsumer', { name: 'basic-auth' }));
    expect(runOptionsNote('consumer', 'my-auth')).toBe(t('pl.meta.signInCustom', { name: 'my-auth' }));
    expect(runOptionsNote('consumer', 'my-auth')).not.toContain('never runs');
  });
});
