// What a consumer's or credential's auth plugin card says (plugins/auth.ts signInRole, signInOf):
// its badge, its note and its run-options note. Revoke advice names only what certainly stops the
// entry from being used: deleting it, or changing the field APISIX looks it up by (SIGN_IN_FIELD).
// jwe-decrypt decrypts a token rather than signing a request in, so its wording says that.
import { t } from '../i18n';
import { AUTH_PLUGINS } from './subsystems';
import { decryptsOnly, type SignIn } from './auth';

const BUILT_IN_AUTH = new Set(AUTH_PLUGINS);

/** The badge for a sign-in plugin's state, or for one APISIX doesn't know ('unused'); "Still signs in" is the danger one. */
export function signInBadge(name: string, state: SignIn['state'] | 'unused'): { label: string; className: string } {
  const decrypts = decryptsOnly(name);
  switch (state) {
    case 'on':
      return { label: t('pl.card.signIn.always'), className: 'pl-card__signin' };
    case 'stillSignsIn':
      return { label: t(decrypts ? 'pl.card.signIn.stillUsed' : 'pl.card.signIn.stillSignsIn'), className: 'pl-card__signin pl-card__signin--on-anyway' };
    case 'signsNobodyIn':
      return { label: t(decrypts ? 'pl.card.signIn.decryptsNothing' : 'pl.card.signIn.signsNobodyIn'), className: 'pl-card__signin' };
    case 'offIgnored':
      return { label: t('pl.card.signIn.offIgnored'), className: 'pl-card__signin' };
    case 'unused':
      return { label: t('pl.card.signIn.unused'), className: 'pl-card__signin' };
  }
}

/** The card's note: what the entry is used for, and what revokes it. */
export function signInNote(name: string, { state, field, missing }: SignIn): string {
  const decrypts = decryptsOnly(name);
  if (state === 'signsNobodyIn') return t(decrypts ? 'pl.card.signIn.incompleteNoteDecrypt' : 'pl.card.signIn.incompleteNote', { missing: missing ?? '' });
  if (field === undefined) return t(state === 'on' ? 'pl.card.signIn.noteNeutral' : 'pl.card.signIn.offIgnoredNote');
  if (state === 'on') return t(decrypts ? 'pl.card.signIn.noteDecrypt' : 'pl.card.signIn.note', { field });
  return t(decrypts ? 'pl.card.signIn.offNoteDecrypt' : 'pl.card.signIn.offNote', { field });
}

/**
 * What the run options of an auth plugin of a consumer or credential do. A credential's plugin is
 * only looked up (its consumer is what attaches: consumer.lua 98–145), and a built-in auth plugin
 * has a rewrite phase only, which APISIX skips for an auth plugin from a consumer (plugin.lua
 * 612–614): neither ever runs there. A consumer's custom auth plugin is merged into the route
 * (merge_consumer_route, plugin.lua 818–867), so its other phases may run, with these options.
 */
export function runOptionsNote(scope: 'consumer' | 'credential', name: string): string {
  if (scope === 'credential') return t('pl.meta.signInCredential', { name });
  return t(BUILT_IN_AUTH.has(name) ? 'pl.meta.signInConsumer' : 'pl.meta.signInCustom', { name });
}
