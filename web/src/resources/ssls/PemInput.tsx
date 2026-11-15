// A PEM text box: paste, upload a file, or drop a file or text on it. What it shows and what it takes
// are the caller's (PemBoxes, following pemBox.ts); this box says when the text is not taken
// (`problem`), and while it says so it holds Save (usePending), names itself in the message, and
// marks itself aria-invalid, as every field that holds input does. A file is checked before it is read
// (at most 64 KiB, the schema's limit for a certificate or key) and after (text, not DER or PKCS#12),
// then judged by the caller (`onFile`) before anything changes; why it was refused is said at the
// field, before any other problem, never with any of its content. Dropped text is a paste; a drop with
// neither a file nor text changes nothing. A drop gives the box no focus, which is why the caller
// decides what the box shows from whether its textarea (`inputRef`) has focus, not from focus events.
// A file is read asynchronously: a read that finishes after anything later happened in the box (text
// typed, pasted or dropped, another file, a change the caller made, a lock (a save in flight
// included), the end of the editing session, the box going away) is stale, and its result is ignored
// before the caller hears of it (Task 16b, item 147).
import { Upload } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode, type Ref } from 'react';
import { t } from '../../i18n';
import { FILE_DROP_ZONE } from '../../shell/fileDrops';
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
  /** The textarea, so the caller can tell whether it has focus when text arrives. */
  inputRef?: Ref<HTMLTextAreaElement>;
  /** How many times the caller changed the text for the user (not the masking on leaving): a refused file's reason lasts until it moves on. */
  changes: number;
  /**
   * Judges an uploaded or dropped file's text before anything changes (pemBox.ts rule 5): returns why
   * it is refused (shown at the field, before any other problem, until the box next changes), or
   * undefined once the caller has put it in the box or taken it.
   */
  onFile: (text: string) => string | undefined;
  /** A file reached the box that could not be read as text (too big, binary, unreadable): nothing changes but what the caller made of the last file. */
  onUnreadable?: () => void;
  /** How the last refused file's reason reads now (the caller's split offer may point at its action instead); as it is by default. */
  fileReason?: (why: string) => string;
  autoFocus?: boolean;
  rows?: number;
}

export function PemInput({ label, value, onChange, problem, help, error, onBlur, inputRef, changes, onFile, onUnreadable, fileReason, autoFocus, rows = 6 }: PemInputProps) {
  const locked = useLocked();
  usePending(locked || problem === undefined ? undefined : t('ui.pending.problem', { field: label, problem }));
  const fileRef = useRef<HTMLInputElement>(null);
  /** View state: a file is being dragged over the box. */
  const [over, setOver] = useState(false);
  /**
   * Editing state: why the last file wasn't put in the box, and the caller's count of changes then:
   * the reason shows until the box next changes, however it changes (typed, or given its part of a
   * split PEM), and not because it was left. Never the text itself, which may hold a key.
   */
  const [refused, setRefused] = useEditingState<{ why: string; at: number } | undefined>(undefined);
  const changesNow = useRef(changes);
  useLayoutEffect(() => {
    changesNow.current = changes;
  });
  const setFileProblem = (why: string | undefined) => setRefused(why === undefined ? undefined : { why, at: changesNow.current });
  const fileProblem = refused && refused.at === changes ? (fileReason?.(refused.why) ?? refused.why) : undefined;

  /**
   * Counts what happens in the box that makes a read still in progress stale: a text gesture, another
   * file, and (below) a lock for any reason, a save in flight included (fix round 1, R3.2), the end of
   * the editing session, or the box going. A read also goes stale when the caller changed the text
   * meanwhile (`changes`: a split's part arriving).
   */
  const gestures = useRef(0);
  // Editing state: one token per editing session; its effect's cleanup runs when the session ends, when the box locks or unlocks, and when it goes.
  const [session] = useEditingState(() => ({}));
  useEffect(
    () => () => {
      gestures.current++;
    },
    [session, locked],
  );

  const read = (file: File | undefined) => {
    if (!file) return;
    const mine = ++gestures.current;
    const at = changesNow.current;
    const fresh = () => gestures.current === mine && changesNow.current === at;
    readPem(file)
      .then((result) => {
        if (!fresh()) return;
        if ('text' in result) {
          setFileProblem(onFile(result.text));
          return;
        }
        onUnreadable?.();
        setFileProblem(result.problem);
      })
      .catch(() => {
        if (!fresh()) return;
        onUnreadable?.();
        setFileProblem(t('ssl.pem.readFailed'));
        toast.error(t('ssl.pem.readFailed'), { pageBound: true });
      });
  };
  const change = (text: string) => {
    gestures.current++;
    setRefused(undefined);
    onChange(text);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) return read(file);
    // Dropped plain text is a paste, not a file; a drop that carries neither changes nothing (rule 7).
    const text = e.dataTransfer.getData('text/plain');
    if (text !== '') change(text);
  };
  // Both the file's reason and the text's problem show, the file's first (rule 5).
  const shown = [fileProblem, problem ?? error].filter((m): m is string => m !== undefined && m !== '');

  return (
    <div
      className={over ? 'ssl-pem ssl-pem--over' : 'ssl-pem'}
      // A drop zone of its own: the window's guard for dropped files leaves it alone (shell/fileDrops.ts).
      {...FILE_DROP_ZONE}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <Textarea
        ref={inputRef}
        label={label}
        help={help}
        error={shown.length > 0 ? shown.join(' ') : undefined}
        mono
        rows={rows}
        value={value}
        placeholder="-----BEGIN …-----"
        onChange={change}
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
