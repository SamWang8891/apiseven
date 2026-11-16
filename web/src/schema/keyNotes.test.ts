// The cheap checks that let an editing JSON view skip walking a large value on every keystroke
// (fix round 2, R3.3): they must never say "nothing" for text that holds a note, a key or a never-shown name.
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { holdsKeyMaterial, mayHoldKeys, mayHoldNotes, newKeyNotes, veilValue } from './keyNotes';

describe('mayHoldKeys / mayHoldNotes', () => {
  const PEM = '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----';

  it('false for ordinary JSON; true for a note, what is left of one, a BEGIN line or a never-shown name', () => {
    const plain = JSON.stringify({ uri: '/a', labels: { a: 'b' }, desc: 'no keys here' });
    expect(mayHoldKeys(plain)).toBe(false);
    expect(mayHoldNotes(plain)).toBe(false);
    const veiled = JSON.stringify(veilValue({ desc: PEM }, newKeyNotes()).value);
    expect(mayHoldNotes(veiled)).toBe(true);
    expect(mayHoldNotes(JSON.stringify({ desc: t('json.keyNote', { id: 'abcdefgh.1' }).replace(/•/g, '') }))).toBe(true);
    expect(mayHoldNotes(JSON.stringify({ desc: 'one • dot' }))).toBe(true);
    expect(mayHoldKeys(JSON.stringify({ desc: PEM }))).toBe(true);
    expect(mayHoldKeys(JSON.stringify({ tls: { client_key: 'AES-ciphertext' } }))).toBe(true);
  });

  // Fix round 4, F6: rule 6 of keyNotes.ts.
  it('true for any text with a \\u escape, which can spell a note, a mask run or a BEGIN line the plain checks miss', () => {
    const escaped = (text: string) => JSON.stringify({ desc: '§' }).replace('"§"', `"${text}"`);
    for (const text of [escaped('\\u0078'), escaped('\\u2022'.repeat(8)), JSON.stringify({ desc: PEM }).replace(/-/g, '\\u002d')]) {
      expect(mayHoldNotes(text), text).toBe(true);
      expect(mayHoldKeys(text), text).toBe(true);
    }
  });
});

// Fix round 4, F4: what makes a view empty its undo history on leaving.
describe('holdsKeyMaterial', () => {
  const PEM = '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----';
  const CERT = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----';

  it('true for a private-key BEGIN line, as written or spelled with \\u escapes; false for a certificate or an escape that spells none', () => {
    expect(holdsKeyMaterial(JSON.stringify({ desc: PEM }))).toBe(true);
    expect(holdsKeyMaterial(JSON.stringify({ desc: PEM }).replace(/-/g, '\\u002d'))).toBe(true);
    expect(holdsKeyMaterial(JSON.stringify({ cert: CERT }))).toBe(false);
    expect(holdsKeyMaterial(JSON.stringify({ cert: CERT, desc: 'x' }).replace('"x"', '"caf\\u00e9"'))).toBe(false);
  });
});
