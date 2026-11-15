// A proto's content as APISIX reads it: source first, else a base64 descriptor set (content.ts).
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { CONTENT_MAX, decodedSize, formatBytes, fromBase64, isDescriptorSet, readProtoFile, toBase64 } from './content';

const enc = (text: string) => new TextEncoder().encode(text);
const DESCRIPTOR = new Uint8Array([0x0a, 0x0f, 0x0a, 0x07, ...enc('a.proto'), 0x12, 0x04, ...enc('demo')]);

describe('isDescriptorSet', () => {
  it('base64 whose first byte is 0x0A (FileDescriptorSet.file): never proto source', () => {
    expect(isDescriptorSet(toBase64(DESCRIPTOR))).toBe(true);
    expect(isDescriptorSet('syntax = "proto3";')).toBe(false);
    expect(isDescriptorSet('Cgo=')).toBe(true);
    // base64, but not of a descriptor set; and a run of letters that is no proto either.
    expect(isDescriptorSet(btoa('hello!'))).toBe(false);
    expect(isDescriptorSet('abcd')).toBe(false);
    // ngx.decode_base64 refuses white space: wrapped base64 is not taken.
    expect(isDescriptorSet(`${toBase64(DESCRIPTOR).slice(0, 8)}\n${toBase64(DESCRIPTOR).slice(8)}`)).toBe(false);
    expect(isDescriptorSet(undefined)).toBe(false);
  });

  it('round-trips bytes and knows their size', () => {
    expect([...fromBase64(toBase64(DESCRIPTOR))]).toEqual([...DESCRIPTOR]);
    expect(decodedSize(toBase64(DESCRIPTOR))).toBe(DESCRIPTOR.length);
    expect(decodedSize(toBase64(new Uint8Array(4)))).toBe(4);
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('readProtoFile', () => {
  it('UTF-8 text without control characters is source, taken as it is', async () => {
    expect(await readProtoFile(new File(['syntax = "proto3";\n\tpackage a;\r\n'], 'a.proto'))).toEqual({ content: 'syntax = "proto3";\n\tpackage a;\r\n', binary: false });
  });

  it('a compiled descriptor set is taken as base64, also when its bytes read as text and its name says compiled', async () => {
    expect(await readProtoFile(new File([DESCRIPTOR], 'set.bin'))).toEqual({ content: toBase64(DESCRIPTOR), binary: true });
    const textLike = new Uint8Array([0x0a, 0x0c, 0x0a, 0x0a, ...enc('a.proto')]);
    expect(await readProtoFile(new File([textLike], 'set.pb'))).toEqual({ content: toBase64(textLike), binary: true });
  });

  it('refuses anything else, and what is too big before reading it; never with the file’s content', async () => {
    expect(await readProtoFile(new File([new Uint8Array([0x00, 0xff, 0x41])], 'x.bin'))).toEqual({ problem: t('pr.file.notDescriptor') });
    const huge = new File(['x'], 'huge.proto');
    Object.defineProperty(huge, 'size', { value: 4 * CONTENT_MAX + 1 });
    const read = vi.spyOn(huge, 'arrayBuffer');
    expect(await readProtoFile(huge)).toEqual({ problem: t('pr.file.tooBig', { size: formatBytes(4 * CONTENT_MAX + 1) }) });
    expect(read).not.toHaveBeenCalled();
    expect(await readProtoFile(new File(['a'.repeat(CONTENT_MAX + 1)], 'long.proto'))).toEqual({ problem: t('pr.file.tooLong') });
    // A descriptor set whose base64 would pass the limit.
    const big = new Uint8Array(Math.floor((CONTENT_MAX * 3) / 4) + 3);
    big[0] = 0x0a;
    big[1] = 0x12;
    expect(await readProtoFile(new File([big], 'big.pb'))).toEqual({ problem: t('pr.file.tooLong') });
  });
});
