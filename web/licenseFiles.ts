// What every build ships beside the app: the project's LICENSE and NOTICE (from the repository root,
// as LICENSE.txt and NOTICE.txt: the server serves .txt as text and no dotfile), and the bundled
// dependencies' licences, which Vite writes with build.license to THIRD-PARTY-LICENSES.txt
// (vite.config.ts). The normal build, the static zip and the image hold all three; the single file
// carries the notice at its top and has them beside it (singleFile.ts).
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** The three files, at the root of the built folder. */
export const LICENSE_FILES = ['LICENSE.txt', 'NOTICE.txt', 'THIRD-PARTY-LICENSES.txt'] as const;
export const THIRD_PARTY_FILE = 'THIRD-PARTY-LICENSES.txt';

/** Emits LICENSE.txt and NOTICE.txt, copied from `licensePath` and `noticePath`. */
export function licenseFiles(licensePath: string, noticePath: string): Plugin {
  return {
    name: 'apiseven-license-files',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: readFileSync(licensePath, 'utf8') });
      this.emitFile({ type: 'asset', fileName: 'NOTICE.txt', source: readFileSync(noticePath, 'utf8') });
    },
  };
}
