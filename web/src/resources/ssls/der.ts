// A minimal DER reader (moved out of parseCert.ts, which reads certificates with it; keyMatch.ts reads
// private keys and public keys with it): pure, synchronous, definite lengths only. Any malformed or
// out-of-bounds read throws Malformed, which the callers turn into "can't read it".

/** Any malformed or out-of-bounds read. */
export class Malformed extends Error {}

export function fail(): never {
  throw new Malformed();
}

/** A DER element: its tag and the bounds of its contents in `der`. */
export interface Node {
  tag: number;
  start: number;
  end: number;
}

export const BOOLEAN = 0x01;
export const INTEGER = 0x02;
export const BIT_STRING = 0x03;
export const OCTET_STRING = 0x04;
export const OID = 0x06;
export const SEQUENCE = 0x30;
export const SET = 0x31;

function byte(der: Uint8Array, at: number, limit: number): number {
  const value = at < limit ? der[at] : undefined;
  return value ?? fail();
}

/** Reads the element at `at`, which must end by `limit`. Definite lengths only. */
export function readNode(der: Uint8Array, at: number, limit: number): Node {
  const tag = byte(der, at, limit);
  // High tag numbers (0x1f) never occur in the parts read here.
  if ((tag & 0x1f) === 0x1f) fail();
  let length = byte(der, at + 1, limit);
  let start = at + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    // 0 is the indefinite form, which DER forbids; more than 4 bytes cannot fit any real certificate or key.
    if (count === 0 || count > 4) fail();
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + byte(der, start + i, limit);
    start += count;
  }
  const end = start + length;
  if (end > limit) fail();
  return { tag, start, end };
}

export function ofTag(node: Node | undefined, tag: number): Node {
  return node?.tag === tag ? node : fail();
}

export function children(der: Uint8Array, parent: Node): Node[] {
  const out: Node[] = [];
  for (let at = parent.start; at < parent.end; ) {
    const node = readNode(der, at, parent.end);
    out.push(node);
    at = node.end;
  }
  return out;
}

export const bytesOf = <T extends ArrayBufferLike>(der: Uint8Array<T>, node: Node): Uint8Array<T> => der.subarray(node.start, node.end);

export function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out.toUpperCase();
}

/** The dotted form of an OBJECT IDENTIFIER's contents. */
export function oid(bytes: Uint8Array): string {
  const arcs: number[] = [];
  let value = 0;
  for (const [i, b] of bytes.entries()) {
    value = value * 128 + (b & 0x7f);
    if (value > Number.MAX_SAFE_INTEGER) fail();
    if (b & 0x80) {
      if (i === bytes.length - 1) fail();
      continue;
    }
    if (arcs.length === 0) {
      // The first subidentifier packs the first two arcs: 40 * first + second.
      const first = Math.min(2, Math.floor(value / 40));
      arcs.push(first, value - 40 * first);
    } else {
      arcs.push(value);
    }
    value = 0;
  }
  return arcs.length > 0 ? arcs.join('.') : fail();
}

/** Every element of the whole of `der`, which must be exactly one element. */
export function root(der: Uint8Array): Node {
  const node = readNode(der, 0, der.length);
  if (node.end !== der.length) fail();
  return node;
}
