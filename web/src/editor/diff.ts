// A line diff for showing two versions of an object (pretty JSON) side by side in one column.

export interface DiffLine {
  op: 'same' | 'add' | 'del';
  text: string;
}

export type Hunk = DiffLine | { op: 'skip'; count: number };

/** Above this many cells the middle is shown as all removed then all added, instead of aligned. */
const MAX_CELLS = 4_000_000;

/**
 * The lines of `a` and `b` aligned on their longest common subsequence: `del` lines are only in
 * `a`, `add` lines only in `b`. Where a line was replaced, its removal comes before its addition.
 */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.split('\n');
  const y = b.split('\n');
  // The common head and tail need no table.
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;

  const xs = x.slice(head, x.length - tail);
  const ys = y.slice(head, y.length - tail);
  // Appended line by line: an object can have more lines than push(...lines) takes as arguments
  // (140,000 labels overflow the call stack), so no list of lines is ever spread.
  const out: DiffLine[] = [];
  for (let i = 0; i < head; i++) out.push({ op: 'same', text: x[i] ?? '' });
  middle(xs, ys, out);
  for (let i = x.length - tail; i < x.length; i++) out.push({ op: 'same', text: x[i] ?? '' });
  return out;
}

/** The aligned lines of the changed middle, appended to `out`. */
function middle(xs: string[], ys: string[], out: DiffLine[]): void {
  const n = xs.length;
  const m = ys.length;
  if (n * m > MAX_CELLS) {
    for (const text of xs) out.push({ op: 'del', text });
    for (const text of ys) out.push({ op: 'add', text });
    return;
  }
  // lcs[i][j]: the common subsequence length of xs[i..] and ys[j..], in one flat array.
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = xs[i] === ys[j] ? (lcs[(i + 1) * w + j + 1] ?? 0) + 1 : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + j + 1] ?? 0);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && xs[i] === ys[j]) {
      out.push({ op: 'same', text: xs[i] ?? '' });
      i++;
      j++;
    } else if (j >= m || (i < n && (lcs[(i + 1) * w + j] ?? 0) >= (lcs[i * w + j + 1] ?? 0))) {
      out.push({ op: 'del', text: xs[i] ?? '' });
      i++;
    } else {
      out.push({ op: 'add', text: ys[j] ?? '' });
      j++;
    }
  }
}

/**
 * The diff with each run of unchanged lines more than `context` lines away from a change folded
 * into one `skip`. A run is folded only when that hides at least two lines.
 */
export function hunks(lines: DiffLine[], context = 3): Hunk[] {
  const near = lines.map(() => false);
  lines.forEach((line, i) => {
    if (line.op === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) near[k] = true;
  });
  const out: Hunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as DiffLine;
    if (line.op !== 'same' || near[i]) {
      out.push(line);
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end]?.op === 'same' && !near[end]) end++;
    if (end - i >= 2) out.push({ op: 'skip', count: end - i });
    else for (let k = i; k < end; k++) out.push(lines[k] as DiffLine);
    i = end;
  }
  return out;
}
