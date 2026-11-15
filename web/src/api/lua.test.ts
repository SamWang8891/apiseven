import { describe, expect, it } from 'vitest';
import { isLuaArray, isLuaObject } from './lua';

describe('the JSON types as APISIX\'s validator sees Lua tables', () => {
  it('an empty table is both an array and an object; a non-empty one is one or the other', () => {
    expect([isLuaObject({}), isLuaObject([]), isLuaObject({ a: 1 }), isLuaObject(['a']), isLuaObject('x'), isLuaObject(null)]).toEqual([true, true, true, false, false, false]);
    expect([isLuaArray([]), isLuaArray({}), isLuaArray(['a']), isLuaArray({ a: 1 }), isLuaArray('x'), isLuaArray(undefined)]).toEqual([true, true, true, false, false, false]);
  });
});
