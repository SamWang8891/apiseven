// What a PEM private key is in text, and the text with it taken out: the one detection the whole app
// uses (schema/secrets.ts re-exports it), free of dependencies so the kit's own controls can use it
// (fix round 1, Y2: a key typed into a box that refuses it is masked when the box is left).

/** The first line of a PEM private key of any form (PKCS#8, PKCS#1 RSA, SEC1 EC, DSA, encrypted). */
const KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

/** Every PEM private-key block in a text, to its END line (or to the end of the text when that is missing). */
const KEY_BLOCKS = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;

/** Whether `text` holds a PEM private key anywhere (a combined certificate + key file does). */
export const holdsPrivateKey = (text: unknown): boolean => typeof text === 'string' && KEY_BEGIN.test(text);

/** `text` with each PEM private-key block replaced by `by` (or what it returns for the block); the rest, certificates included, kept. */
export const withoutPrivateKeys = (text: string, by: string | ((block: string) => string)): string =>
  typeof by === 'string' ? text.replace(KEY_BLOCKS, () => by) : text.replace(KEY_BLOCKS, by);
