// The header's status switch of a kind with a status (moved out of Editor.tsx): what it shows, and
// what a change does to the draft.
import type { RefObject } from 'react';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import type { ResourceDef } from '../resources/registry';
import { isEnabled } from '../resources/resolve';
import { toast, type PendingEntry } from '../ui';
import { setPath } from './draft';
import type { EditorHeaderProps } from './EditorHeader';

export interface HeaderStatusArgs {
  def: ResourceDef;
  draft: Obj;
  name: string;
  /** Input the JSON tab holds, when it is the active tab. */
  held: PendingEntry | undefined;
  /** The editor's body: the field that holds input is focused in it. */
  body: RefObject<HTMLElement | null>;
  edit: (next: Obj) => void;
}

/**
 * The status, for kinds that have one (a hook only in name: it reads `body` in the switch's handler). It is part of the JSON tab's text: while that text holds
 * Save, the switch would change a draft the text no longer follows, and fixing the text would undo
 * it. It waits instead.
 */
export function useHeaderStatus({ def, draft, name, held, body, edit }: HeaderStatusArgs): EditorHeaderProps['status'] {
  if (!def.hasStatus) return undefined;
  return {
    enabled: isEnabled(draft),
    ignored: def.statusIgnored?.(draft),
    name,
    onChange: (on: boolean) => {
      if (held) {
        toast.error(t('ui.pending.refused', { message: held.message }));
        body.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) [aria-invalid="true"]')?.focus();
        return;
      }
      edit(setPath(draft, ['status'], on ? 1 : 0));
    },
  };
}
