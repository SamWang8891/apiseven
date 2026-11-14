import type { Kind, Parent } from '../api/types';
import { t } from '../i18n';
import { registry } from '../resources/registry';
import { pathFor } from '../router/paths';

/** Where "back" goes: the kind's list; for a credential, its consumer. */
export function backOf(kind: Kind, parent?: Parent): { to: string; label: string } {
  if (kind === 'credentials' && parent) {
    return { to: pathFor('consumers', parent.consumer), label: t('editor.backTo', { kind: registry.consumers.singular, name: parent.consumer }) };
  }
  return { to: pathFor(kind), label: t('editor.back', { plural: registry[kind].plural }) };
}
