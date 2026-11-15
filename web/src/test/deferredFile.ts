// A file whose text arrives only when `release` is called: a read left pending (Task 16b, item 147),
// for the PEM box tests and the property harness (test/pemBoxRun.ts).

/** `file` with `File.text()` answering `text` once `release` is called. */
export function deferredFile(file: File, text: string): { file: File; release: () => void } {
  let release = () => {};
  const arrives = new Promise<string>((done) => (release = () => done(text)));
  Object.defineProperty(file, 'text', { value: () => arrives });
  return { file, release: () => release() };
}
