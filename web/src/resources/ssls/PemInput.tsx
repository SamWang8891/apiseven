// A PEM text box: paste, upload a file, or drop one on it. What it shows and what it takes are the
// caller's (a dialog's own text, or a draft field); this box only says when the text can't be taken
// (`problem`, from pem.ts), and while it says so it holds Save (usePending), names itself in the
// message, and marks itself aria-invalid, as every field that holds input does.
import { Upload } from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { t } from '../../i18n';
import { Button, Textarea, useLocked, usePending } from '../../ui';

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
  autoFocus?: boolean;
  rows?: number;
}

export function PemInput({ label, value, onChange, problem, help, error, onBlur, autoFocus, rows = 6 }: PemInputProps) {
  const locked = useLocked();
  usePending(locked || problem === undefined ? undefined : t('ui.pending.problem', { field: label, problem }));
  const fileRef = useRef<HTMLInputElement>(null);
  /** View state: a file is being dragged over the box. */
  const [over, setOver] = useState(false);

  const read = (file: File | undefined) => {
    if (file) void file.text().then(onChange);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) read(file);
    else onChange(e.dataTransfer.getData('text/plain'));
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
        error={problem ?? error}
        mono
        rows={rows}
        value={value}
        placeholder="-----BEGIN …-----"
        onChange={onChange}
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
