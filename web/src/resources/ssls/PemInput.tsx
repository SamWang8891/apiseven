// A PEM text box: paste, upload a file, or drop one on it. What it shows and what it takes are the
// caller's (a dialog's own text, or a draft field); this box only says when the text can't be taken
// (`problem`, from pem.ts), and while it says so it holds Save (usePending), names itself in the
// message, and marks itself aria-invalid, as every field that holds input does. A file is checked
// before it is read (at most 64 KiB, the schema's limit for a certificate or key) and after (text,
// not DER or PKCS#12); a problem with it is said at the field, never with any of its content.
import { Upload } from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { t } from '../../i18n';
import { Button, Textarea, toast, useEditingState, useLocked, usePending } from '../../ui';

/** certificate_scheme / private_key_schema maxLength (schema_def.lua 407–415). */
const MAX_BYTES = 64 * 1024;

/** Whether decoded file text is binary: control characters other than tab and line ends, or bytes that weren't UTF-8 (U+FFFD). */
function binary(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0xfffd || (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d)) return true;
  }
  return false;
}

/** A file's text, or why it can't be put in the box. The size is checked before anything is read. */
async function readPem(file: File): Promise<{ text: string } | { problem: string }> {
  if (file.size > MAX_BYTES) return { problem: t('ssl.pem.tooBig', { size: `${Math.ceil(file.size / 1024)} KiB` }) };
  const text = await file.text();
  return binary(text) ? { problem: t('ssl.pem.binary') } : { text };
}

export interface PemInputProps {
  label: string;
  value: string;
  onChange: (text: string) => void;
  /** Why the text can't be taken as it is; the box holds Save while it says so. */
  problem: string | undefined;
  help?: ReactNode;
  /** A problem with the stored value (an issue), shown when the text itself has none. */
  error?: string;
  onBlur?: () => void;
  /** Where the text of an uploaded or dropped file goes; default onChange. */
  onFile?: (text: string) => void;
  autoFocus?: boolean;
  rows?: number;
}

export function PemInput({ label, value, onChange, problem, help, error, onBlur, onFile, autoFocus, rows = 6 }: PemInputProps) {
  const locked = useLocked();
  usePending(locked || problem === undefined ? undefined : t('ui.pending.problem', { field: label, problem }));
  const fileRef = useRef<HTMLInputElement>(null);
  /** View state: a file is being dragged over the box. */
  const [over, setOver] = useState(false);
  /** Editing state: why the last file wasn't put in the box (until the next change). */
  const [fileProblem, setFileProblem] = useEditingState<string | undefined>(undefined);
  const arrived = onFile ?? onChange;

  const read = (file: File | undefined) => {
    if (!file) return;
    setFileProblem(undefined);
    readPem(file)
      .then((result) => ('text' in result ? arrived(result.text) : setFileProblem(result.problem)))
      .catch(() => {
        setFileProblem(t('ssl.pem.readFailed'));
        toast.error(t('ssl.pem.readFailed'));
      });
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) read(file);
    else arrived(e.dataTransfer.getData('text/plain'));
  };

  return (
    <div
      className={over ? 'ssl-pem ssl-pem--over' : 'ssl-pem'}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <Textarea
        label={label}
        help={help}
        error={fileProblem ?? problem ?? error}
        mono
        rows={rows}
        value={value}
        placeholder="-----BEGIN …-----"
        onChange={(text) => {
          setFileProblem(undefined);
          onChange(text);
        }}
        onBlur={onBlur}
        autoFocus={autoFocus}
      />
      {!locked && (
        <span className="ssl-pem__bar">
          <input
            ref={fileRef}
            type="file"
            accept=".pem,.crt,.cer,.key,text/plain"
            className="ssl-pem__file"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              read(file);
            }}
          />
          <Button size="sm" variant="ghost" icon={<Upload size={13} />} aria-label={t('ssl.pem.uploadLabel', { label })} onClick={() => fileRef.current?.click()}>
            {t('ssl.pem.upload')}
          </Button>
        </span>
      )}
    </div>
  );
}
