// What APISIX 3.20 refuses in a proto, checked in the browser so Save can say where: the `proto`
// schema in apisix/schema_def.lua (1000–1018: `content` required, text of 1 to 1,048,576 characters,
// counted as UTF-8 characters by the validator; labels). Whether the content compiles is APISIX's to
// say (admin/proto.lua 33–36, "invalid content: …"). Pure; the registry uses it as the proto's `validate`.
import type { Obj } from '../../api/types';
import type { Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { labelsRefused } from '../routes/validate';
import { characters, CONTENT_MAX } from './content';

/** Problems in a proto draft, each at its path, for the editor to show on the right tab. */
export function protoIssues(draft: Obj): Issue[] {
  const issues: Issue[] = [];
  const { content } = draft;
  // required = {"content"} (1016); minLength = 1 (1013).
  if (content === undefined || content === '') issues.push({ path: 'content', message: t('pr.issue.content') });
  // type = "string" (1013).
  else if (typeof content !== 'string') issues.push({ path: 'content', message: t('pr.issue.contentText') });
  // maxLength = 1024*1024 (1013).
  else if (characters(content) > CONTENT_MAX) issues.push({ path: 'content', message: t('pr.issue.contentLength') });
  // labels_def (108–115), shared with the other kinds.
  if (labelsRefused(draft.labels)) issues.push({ path: 'labels', message: t('rt.issue.labels') });
  return issues;
}
