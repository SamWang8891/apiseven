// What stopped the last save, for the banner above the tabs: APISIX's refusal, or the editor's own
// when a create's id is taken or could not be checked (saveResource never overwrites).
import type { ApiError } from '../api/errors';
import type { Item, Kind, Parent } from '../api/types';
import { t } from '../i18n';
import { registry } from '../resources/registry';
import { pathFor } from '../router/paths';

export interface Failure {
  message: string;
  /** The draft path it is about, when that is certain: its tab is badged and its field told. */
  path?: string;
  /** The banner's title; default: APISIX's refusal (and the message is APISIX's own, in mono). */
  title?: string;
  /** Where to go about it (the object that holds the id). */
  link?: { to: string; label: string };
  /** The id a create found taken: the ID field says so while it still holds that id. */
  taken?: string;
  /**
   * What holds the id, when it belongs on this very page (a plugin's metadata page whose entry was
   * configured meanwhile): the banner offers to show it instead of linking to the page it is on.
   */
  holder?: Item;
}

/**
 * A create refused because `holder` already has the id (on the kind's id field, when the id is one: a
 * consumer's username). `here`: the page is that id's own (ResourceDef.createWhenMissing), so instead
 * of a link to it the banner offers to show what is stored.
 */
export function takenFailure(kind: Kind, holder: Item, parent?: Parent, here = false): Failure {
  const def = registry[kind];
  return {
    title: t('editor.taken.title'),
    message: t('editor.taken.message', { kind: def.singular, id: holder.id }),
    path: def.idField,
    ...(here ? { holder } : { link: { to: pathFor(kind, holder.id, parent), label: t('editor.taken.open', { kind: def.singular, id: holder.id }) } }),
    taken: holder.id,
  };
}

/** A create refused because whether the id is free could not be checked. */
export function uncheckedFailure(id: string, error: ApiError): Failure {
  return { title: t('editor.taken.title'), message: t('editor.taken.unchecked', { id, error: error.errorMsg ?? error.message }) };
}
