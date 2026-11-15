// A proto's `content` as APISIX 3.20 reads it (plugins/grpc-transcode/proto.lua compile_proto,
// 100–110): first as .proto source (compile_proto_text, 33–65, protoc); when that fails, as a
// FileDescriptorSet in base64 (compile_proto_bin, 68–97: ngx.decode_base64, then pb.load). The schema
// takes 1 to 1,048,576 characters of text (schema_def.lua 1012–1016; the validator counts UTF-8
// characters). So a compiled descriptor set is uploaded as base64, and shown as one.
import { t } from '../../i18n';

/** maxLength of `content` (schema_def.lua 1013), in characters. */
export const CONTENT_MAX = 1024 * 1024;

/** The most bytes a file can have and still fit: four bytes per character at worst. Larger files are refused before they are read. */
const FILE_MAX = 4 * CONTENT_MAX;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Whether `content` is a compiled descriptor set as APISIX takes it: base64 text (no white space,
 * which ngx.decode_base64 refuses) whose first byte is 0x0A, the tag of FileDescriptorSet's `file`
 * field that protoc writes first. Proto source never looks like this: it is not one unbroken run of
 * base64 letters, and source that is one cannot start with "C" (the base64 of 0x0A…) and compile,
 * as no proto statement starts with a capital letter; so APISIX's first attempt, the source, fails
 * on it as well.
 */
export function isDescriptorSet(content: unknown): boolean {
  if (typeof content !== 'string' || content.length < 4 || content.length % 4 !== 0 || !BASE64.test(content)) return false;
  try {
    return atob(content.slice(0, 4)).charCodeAt(0) === 0x0a;
  } catch {
    return false;
  }
}

/** The bytes of base64 text. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Bytes as base64 text, without line breaks. */
export function toBase64(bytes: Uint8Array): string {
  let raw = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) raw += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(raw);
}

/** The bytes base64 text stands for. */
export const decodedSize = (text: string): number => (text.length / 4) * 3 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0);

/** Characters as APISIX's validator counts them (UTF-8 characters: code points). */
export function characters(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // A high surrogate and its low one are one character.
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) i++;
    n++;
  }
  return n;
}

/** The content's size in bytes as stored (UTF-8). */
export const contentBytes = (content: string): number => new TextEncoder().encode(content).length;

/** A size for people: 512 B, 1.5 KB, 2.3 MB. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Text with no control characters other than the white space protoc skips (tab, line ends, form feed, vertical tab). */
function readsAsSource(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c < 0x20 && (c < 0x09 || c > 0x0d)) || c === 0x7f) return false;
  }
  return true;
}

export type ProtoFile = { content: string; binary: boolean } | { problem: string };

/** File names protoc's descriptor sets go by: always read as one. */
const COMPILED = /\.(pb|desc|protoset|bin)$/i;

/**
 * A file as content, or why it can't be (never with any of its content). The size is checked before
 * anything is read. UTF-8 text without control characters is proto source, taken as it is, unless
 * the name says compiled (.pb, .desc, .protoset, .bin); anything else must be a compiled descriptor
 * set (its first byte 0x0A), taken as base64. Either must fit the schema's 1,048,576 characters.
 */
export async function readProtoFile(file: File): Promise<ProtoFile> {
  if (file.size > FILE_MAX) return { problem: t('pr.file.tooBig', { size: formatBytes(file.size) }) };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { problem: t('pr.file.readFailed') };
  }
  let text: string | undefined;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = undefined;
  }
  if (text !== undefined && text !== '' && readsAsSource(text) && !COMPILED.test(file.name)) {
    return characters(text) > CONTENT_MAX ? { problem: t('pr.file.tooLong') } : { content: text, binary: false };
  }
  if (bytes[0] !== 0x0a) return { problem: t('pr.file.notDescriptor') };
  if (4 * Math.ceil(bytes.length / 3) > CONTENT_MAX) return { problem: t('pr.file.tooLong') };
  return { content: toBase64(bytes), binary: true };
}
