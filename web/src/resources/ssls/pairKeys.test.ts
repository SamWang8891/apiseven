import { describe, expect, it } from 'vitest';
import { keyStates, withKeyEntered, withPairAdded, withPairRemoved } from './pairKeys';

const STORED = { snis: ['a.test'], cert: 'C0', certs: ['C1', 'C2'] };

describe('keyStates: where each additional key stands for the next save', () => {
  it('stored while the save is a PATCH without keys and the certs are as loaded', () => {
    expect(keyStates(STORED, false, STORED)).toEqual(['stored', 'stored']);
  });

  it('still stored with a new main key: a stored SSL is saved as a PATCH, which keeps the stored keys', () => {
    expect(keyStates({ ...STORED, key: 'K' }, false, STORED)).toEqual(['stored', 'stored']);
  });

  it('needed on a create: no stored key goes along', () => {
    expect(keyStates({ certs: ['C1'] }, true)).toEqual(['needed']);
  });

  it('entered or needed, place by place, once keys are in the draft', () => {
    expect(keyStates({ ...STORED, keys: [null, 'K2'] }, false, STORED)).toEqual(['needed', 'entered']);
  });

  it('stale where a cert changed in place (APISIX keeps the stored key there); needed when their number changed', () => {
    expect(keyStates({ ...STORED, certs: ['C1', 'C9'] }, false, STORED)).toEqual(['stored', 'stale']);
    expect(keyStates({ ...STORED, certs: ['C1'] }, false, STORED)).toEqual(['needed']);
  });
});

describe('changing the pairs: every remaining key is entered again', () => {
  it('adding a pair to stored ones: their keys become to-be-entered (null), the new one is in place', () => {
    expect(withPairAdded(STORED, 'C3', 'K3')).toEqual({ ...STORED, certs: ['C1', 'C2', 'C3'], keys: [null, null, 'K3'] });
    expect(withPairAdded({ snis: ['a.test'] }, 'C1', 'K1')).toEqual({ snis: ['a.test'], certs: ['C1'], keys: ['K1'] });
  });

  it('removing one keeps the others in order, with their keys as entered or to be entered', () => {
    expect(withPairRemoved(STORED, 0, false, STORED)).toEqual({ ...STORED, certs: ['C2'], keys: [null] });
    expect(withPairRemoved({ ...STORED, keys: ['K1', 'K2'] }, 0, false, STORED)).toEqual({ ...STORED, certs: ['C2'], keys: ['K2'] });
  });

  it('removing the last of a stored set sends keys: [] (APISIX drops the stored keys), with or without a new main key; a new one drops both', () => {
    const one = { ...STORED, certs: ['C1'] };
    expect(withPairRemoved(one, 0, false, one)).toEqual({ snis: ['a.test'], cert: 'C0', keys: [] });
    expect(withPairRemoved({ ...one, key: 'K' }, 0, false, one)).toEqual({ snis: ['a.test'], cert: 'C0', key: 'K', keys: [] });
    expect(withPairRemoved({ certs: ['C1'], keys: ['K1'] }, 0, true)).toEqual({});
  });

  it('a way back: a change that ends with the stored certs and no key entered returns them to stored, with no keys in the draft', () => {
    const added = withPairAdded(STORED, 'C3', 'K3');
    const back = withPairRemoved(added, 2, false, STORED);
    expect(back).toEqual(STORED);
    expect(keyStates(back, false, STORED)).toEqual(['stored', 'stored']);
    // A key entered for a stored cert is a change of its own: it stays.
    expect(withPairRemoved(withKeyEntered(added, 0, 'K1'), 2, false, STORED)).toEqual({ ...STORED, keys: ['K1', null] });
  });

  it('entering one key keeps the others as they are', () => {
    expect(withKeyEntered(STORED, 1, 'K2')).toEqual({ ...STORED, keys: [null, 'K2'] });
    expect(withKeyEntered({ ...STORED, keys: [null, 'K2'] }, 0, 'K1')).toEqual({ ...STORED, keys: ['K1', 'K2'] });
  });
});
