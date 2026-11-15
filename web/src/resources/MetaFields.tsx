// What most General tabs start with: name, description and labels (the credential and consumer
// group editors; the consumer has no name). Labels with a value that isn't text can't be edited
// here; they are kept as they are.
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { setPath } from '../editor/draft';
import { issueAt, type Issue } from '../editor/issues';
import { Input, KeyValueInput, useLocked } from '../ui';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export interface MetaFieldsProps {
  draft: Obj;
  setDraft: (next: Obj) => void;
  issues: Issue[];
  /** The fields' labels; leave out `name` for a kind without one. */
  labels: { name?: string; desc: string; labels: string; labelsHelp: string };
}

export function MetaFields({ draft, setDraft, issues, labels: l }: MetaFieldsProps) {
  const locked = useLocked();
  const labels = isObj(draft.labels) ? draft.labels : {};
  const textLabels = Object.fromEntries(Object.entries(labels).filter((e): e is [string, string] => typeof e[1] === 'string'));
  const otherLabels = Object.fromEntries(Object.entries(labels).filter(([, v]) => typeof v !== 'string'));
  return (
    <>
      {l.name !== undefined && (
        <Input label={l.name} value={text(draft.name)} error={issueAt(issues, 'name')} onChange={(e) => setDraft(setPath(draft, ['name'], e.target.value))} />
      )}
      <Input label={l.desc} value={text(draft.desc)} error={issueAt(issues, 'desc')} onChange={(e) => setDraft(setPath(draft, ['desc'], e.target.value))} />
      <div className="ed-wide">
        <KeyValueInput
          label={l.labels}
          help={locked ? undefined : l.labelsHelp}
          mono
          value={textLabels}
          error={issueAt(issues, 'labels')}
          onChange={(map) => setDraft(setPath(draft, ['labels'], { ...otherLabels, ...map }))}
        />
      </div>
    </>
  );
}
