import { jsonParseLinter } from '@codemirror/lang-json';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { quietWhenBlank } from './languages';

const lint = (doc: string) => {
  const view = new EditorView({ state: EditorState.create({ doc }) });
  const out = quietWhenBlank(jsonParseLinter())(view);
  view.destroy();
  return out;
};

describe('the JSON parse lint', () => {
  it('says nothing about a blank document (an optional value left empty)', () => {
    expect(lint('')).toEqual([]);
    expect(lint('  \n ')).toEqual([]);
  });

  it('still flags text that does not parse', () => {
    expect(lint('{"a": ')).toHaveLength(1);
  });
});
