// The cheap checks that let an editing JSON view skip walking a large value on every keystroke
// (fix round 2, R3.3): they must never say "nothing" for text that holds a note, a key or a never-shown name.
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { mayHoldKeys, mayHoldNotes, newKeyNotes, veilValue } from './keyNotes';

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
});
