// Language support for the CodeEditor. Parsers (and the Ajv-based schema support) are fetched when an
// editor first needs them: a YAML editor never downloads Ajv, a JSON one never downloads the YAML parser.
import { foldGutter, StreamLanguage, type StreamParser } from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { Obj } from '../../api/types';
import type { CodeEditorProps } from '../CodeEditor';

const LINT_DELAY = 300;

async function jsonSupport(schema: Obj | undefined): Promise<Extension> {
  const { json, jsonLanguage, jsonParseLinter } = await import('@codemirror/lang-json');
  const base = [json(), linter(jsonParseLinter(), { delay: LINT_DELAY }), lintGutter(), foldGutter()];
  if (!schema) return base;
  const { schemaCompletionSource, schemaDiagnostics } = await import('./jsonSchema');
  return [
    base,
    linter((view) => schemaDiagnostics(view.state, schema), { delay: LINT_DELAY }),
    jsonLanguage.data.of({ autocomplete: schemaCompletionSource(schema) }),
  ];
}

const streamLanguage = (parser: StreamParser<unknown>): Extension => StreamLanguage.define(parser);

/** The extensions for `language`; `jsonSchema` adds schema lint and completion to 'json'. */
export async function loadLanguage(language: CodeEditorProps['language'], schema: Obj | undefined): Promise<Extension> {
  switch (language) {
    case 'json':
      return jsonSupport(schema);
    case 'yaml':
      return [(await import('@codemirror/lang-yaml')).yaml(), foldGutter()];
    case 'lua':
      return streamLanguage((await import('@codemirror/legacy-modes/mode/lua')).lua);
    case 'proto':
      return streamLanguage((await import('@codemirror/legacy-modes/mode/protobuf')).protobuf);
    case 'pem':
    case 'text':
      return [];
  }
}
