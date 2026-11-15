// The proto editor's Content tab: the proto definition APISIX's grpc-transcode reads (content.ts). As
// source, it is a proto editor whose every keystroke is the content (nothing is held: any text is
// sent, and APISIX compiles it on save, admin/proto.lua 33–36). A compiled descriptor set, uploaded
// as a file, is stored as base64 and shown as a summary (its size) with Replace, Download and a way
// back to source. Whether the content shows as a descriptor set is decided when editing begins and
// when a file is taken, never while typing, so the editor is never swapped out under the cursor. A
// file uploaded or dropped anywhere on the field (the editor never reads a dropped file itself) goes
// through readProtoFile; a refused file changes nothing, and its reason is shown without any of its
// content. Dropped text is a paste into the editor.
import { Download, FileCode, Upload } from 'lucide-react';
import { useRef, type DragEvent } from 'react';
import { setPath } from '../../editor/draft';
import { issueAt } from '../../editor/issues';
import { t } from '../../i18n';
import { useLatest } from '../../schema-form/context';
import { Button, CodeEditor, Field, useEditingState, useLocked } from '../../ui';
import type { TabProps } from '../registry';
import { decodedSize, formatBytes, fromBase64, isDescriptorSet, readProtoFile } from './content';
import '../resources.css';

/** Saves `content` (base64) as a file named after the proto. */
function download(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([fromBase64(content)], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.pb`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ContentTab({ draft, setDraft, issues, id }: TabProps) {
  const locked = useLocked();
  const content = draft.content;
  const text = typeof content === 'string' ? content : '';
  /** Editing state: the content shows as a compiled descriptor set (fixed when editing begins or a file is taken). */
  const [binary, setBinary] = useEditingState(() => isDescriptorSet(content));
  /** Editing state: why the last file was refused, until the content next changes. */
  const [fileProblem, setFileProblem] = useEditingState<string | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  // A file is read asynchronously: its content goes into the draft as it is then.
  const latest = useLatest({ draft, setDraft });

  function take(file: File | undefined) {
    if (!file) return;
    readProtoFile(file)
      .then((result) => {
        if ('problem' in result) {
          setFileProblem(result.problem);
          return;
        }
        setFileProblem(undefined);
        setBinary(result.binary);
        latest.current.setDraft(setPath(latest.current.draft, ['content'], result.content));
      })
      .catch(() => setFileProblem(t('pr.file.readFailed')));
  }

  /** A file dropped on the field: the same as an upload while editing; locked, nothing. */
  const dropZone = locked
    ? {}
    : {
        onDragOver: (e: DragEvent) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        },
        onDrop: (e: DragEvent) => {
          const file = e.dataTransfer.files[0];
          if (!file) return;
          e.preventDefault();
          take(file);
        },
      };

  const write = (next: string | undefined) => {
    setFileProblem(undefined);
    setDraft(setPath(draft, ['content'], next));
  };
  const error = [fileProblem, issueAt(issues, 'content')].filter((m): m is string => m !== undefined).join(' ') || undefined;
  const upload = !locked && (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".proto,.pb,.desc,.protoset,.bin"
        className="res-file__input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          take(file);
        }}
      />
      <Button size="sm" variant="ghost" icon={<Upload size={13} />} aria-label={t('pr.content.uploadLabel')} onClick={() => fileRef.current?.click()}>
        {binary ? t('pr.content.replace') : t('pr.content.upload')}
      </Button>
    </>
  );

  if (binary && isDescriptorSet(content)) {
    return (
      <div {...dropZone}>
        <Field label={t('pr.content.label')} error={error}>
          <div className="res-file">
            <FileCode className="res-file__icon" size={20} aria-hidden="true" />
            <div className="res-file__text">
              <p className="res-file__title">{t('pr.content.binary')}</p>
              <p className="res-file__note">{t('pr.content.binaryNote', { size: formatBytes(decodedSize(text)) })}</p>
            </div>
            <div className="res-file__actions">
              {upload}
              <Button size="sm" variant="ghost" icon={<Download size={13} />} onClick={() => download(text, id ?? 'proto')}>
                {t('pr.content.download')}
              </Button>
              {!locked && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setBinary(false);
                    write(undefined);
                  }}
                >
                  {t('pr.content.toText')}
                </Button>
              )}
            </div>
          </div>
        </Field>
      </div>
    );
  }

  return (
    <div className="ed-stack" {...dropZone}>
      <Field label={t('pr.content.label')} help={locked ? undefined : t('pr.content.help')} error={error}>
        {locked && text === '' ? (
          <p className="res-note">{t('pr.content.empty')}</p>
        ) : (
          <CodeEditor value={text} onChange={(next) => write(next)} language="proto" minLines={14} maxLines={40} aria-label={t('pr.content.label')} aria-invalid={error !== undefined} />
        )}
      </Field>
      {upload && <div className="res-file__bar">{upload}</div>}
    </div>
  );
}
