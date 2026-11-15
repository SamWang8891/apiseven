import { describe, expect, it } from 'vitest';
import { keyStates, withKeyEntered, withPairAdded, withPairRemoved } from './pairKeys';

const STORED = { snis: ['a.test'], cert: 'C0', certs: ['C1', 'C2'] };

describe('keyStates: where each additional key stands for the next save', () => {
  it('stored while the save is a PATCH without keys and the certs are as loaded', () => {
    expect(keyStates(STORED, false, STORED)).toEqual(['stored', 'stored']);
  });

  it('needed once the save is a PUT (a new main key) or a create: no stored key goes along', () => {
    expect(keyStates({ ...STORED, key: 'K' }, false, STORED)).toEqual(['needed', 'needed']);
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

  it('removing the last: a stored object saved as a PATCH sends keys: [] (APISIX drops the stored keys); otherwise both go', () => {
    const one = { ...STORED, certs: ['C1'] };
    expect(withPairRemoved(one, 0, false, one)).toEqual({ snis: ['a.test'], cert: 'C0', keys: [] });
    expect(withPairRemoved({ ...one, key: 'K' }, 0, false, one)).toEqual({ snis: ['a.test'], cert: 'C0', key: 'K' });
    expect(withPairRemoved({ certs: ['C1'], keys: ['K1'] }, 0, true)).toEqual({});
  });

  it('entering one key keeps the others as they are', () => {
    expect(withKeyEntered(STORED, 1, 'K2')).toEqual({ ...STORED, keys: [null, 'K2'] });
    expect(withKeyEntered({ ...STORED, keys: [null, 'K2'] }, 0, 'K1')).toEqual({ ...STORED, keys: ['K1', 'K2'] });
  });
});
