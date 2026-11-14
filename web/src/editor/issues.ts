// Problems with a draft, found in the browser (ResourceDef.validate, the frame's own checks) or named
// by APISIX's answer to a save. Each one is attributed to a tab, which shows its count as a badge.

export interface Issue {
  /** Dotted path into the draft, e.g. 'uri', 'plugins.limit-count.count'; '' for the object as a whole. */
  path: string;
  message: string;
  /** The tab id, when the producer knows it (otherwise the tab owning the path's first segment). */
  tab?: string;
}

/** The message of the issue at exactly `path`. */
export function issueAt(issues: Issue[], path: string): string | undefined {
  return issues.find((issue) => issue.path === path)?.message;
}

const isUnder = (path: string, prefix: string): boolean => prefix === '' || path === prefix || path.startsWith(`${prefix}.`);

/** The issues at `prefix` or below it (`plugins.cors` takes `plugins.cors.x`, not `plugins.cors2`). Paths stay as they are. */
export function issuesUnder(issues: Issue[], prefix: string): Issue[] {
  return issues.filter((issue) => isUnder(issue.path, prefix));
}

/** issuesUnder, with each path made relative to `prefix` (for a form editing just that sub-object). */
export function withinPath(issues: Issue[], prefix: string): Issue[] {
  return issuesUnder(issues, prefix).map((issue) => ({
    ...issue,
    path: prefix === '' ? issue.path : issue.path.slice(prefix.length + 1),
  }));
}

/** What tabOfIssue needs to know of a tab. */
export interface TabFields {
  id: string;
  fields: string[];
}

/** `issue.tab` when such a tab exists, else the tab whose fields hold the path's first segment, else `fallback`. */
export function tabOfIssue(issue: Issue, tabs: TabFields[], fallback: string): string {
  if (issue.tab !== undefined && tabs.some((tab) => tab.id === issue.tab)) return issue.tab;
  const top = issue.path.split('.')[0] ?? '';
  return tabs.find((tab) => top !== '' && tab.fields.includes(top))?.id ?? fallback;
}

/** The issues grouped by the tab they belong to (tabs without any are absent). */
export function issuesByTab(issues: Issue[], tabs: TabFields[], fallback: string): Map<string, Issue[]> {
  const by = new Map<string, Issue[]>();
  for (const issue of issues) {
    const id = tabOfIssue(issue, tabs, fallback);
    by.set(id, [...(by.get(id) ?? []), issue]);
  }
  return by;
}

/**
 * The top-level property an APISIX error names: `invalid configuration: property "uri" validation
 * failed: …` → `uri`. Nested schemas repeat the pattern; the first one is the top-level key.
 */
export function propertyOfError(message: string | undefined): string | undefined {
  return message === undefined ? undefined : /property "([^"]+)"/.exec(message)?.[1];
}
