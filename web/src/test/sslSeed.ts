/// <reference types="node" />
// The certificate and private key dev/seed.mjs installs as SSL `apiseven-test` (a throwaway,
// self-signed pair for *.apiseven.test that protects nothing), for tests. Read from disk: Vite
// refuses imports from outside web/.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../dev/seed.mjs'), 'utf8');

const block = (name: string): string => new RegExp(`const ${name} = \`([^\`]*)\``).exec(script)?.[1] ?? '';

/** The seed's certificate (EC P-256, CN apiseven.test, SANs apiseven.test and *.apiseven.test, until 2036-11-11). */
export const SEED_CERT = block('DEV_CERT');
/** The seed's private key (PKCS#8), the pair of SEED_CERT. */
export const SEED_KEY = block('DEV_KEY');
