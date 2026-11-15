// A proto's content as APISIX reads it: source first, else a base64 descriptor set (content.ts).
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { CONTENT_MAX, decodedSize, formatBytes, fromBase64, isDescriptorSet, readProtoFile, REQUEST_MAX, toBase64 } from './content';

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
    // The Admin API reads at most 1.5 MiB of request body (apisix/admin/init.lua 50, 225): a bigger
    // file never fits, as it is sent as its text (or as base64, larger still) (Task 16b, item 117).
    expect(REQUEST_MAX).toBe(1024 * 1024 * 1.5);
    const huge = new File(['x'], 'huge.proto');
    Object.defineProperty(huge, 'size', { value: 2 * REQUEST_MAX });
    const read = vi.spyOn(huge, 'arrayBuffer');
    expect(await readProtoFile(huge)).toEqual({ problem: t('pr.file.tooBig', { size: formatBytes(2 * REQUEST_MAX) }) });
    expect(t('pr.file.tooBig', { size: formatBytes(2 * REQUEST_MAX) })).toBe('This file is more than the 1.5 MB the Admin API takes in a request (3.0 MB).');
    expect(read).not.toHaveBeenCalled();
    // Just over the cap the size reads as the cap itself: the words say "more than", with no figure (fix round 1, R2.3; fix round 2, M4).
    const near = new File(['x'], 'near.proto');
    Object.defineProperty(near, 'size', { value: REQUEST_MAX + 1 });
    expect(formatBytes(REQUEST_MAX + 1)).toBe('1.5 MB');
    expect(await readProtoFile(near)).toEqual({ problem: t('pr.file.tooBigNear') });
    expect(t('pr.file.tooBigNear')).not.toMatch(/\(/);
    expect(await readProtoFile(new File(['a'.repeat(CONTENT_MAX + 1)], 'long.proto'))).toEqual({ problem: t('pr.file.tooLong') });
    // A descriptor set whose base64 would pass the limit.
    const big = new Uint8Array(Math.floor((CONTENT_MAX * 3) / 4) + 3);
    big[0] = 0x0a;
    big[1] = 0x12;
    expect(await readProtoFile(new File([big], 'big.pb'))).toEqual({ problem: t('pr.file.tooLong') });
  });

  it('refuses source within the character limit whose request would pass the Admin API’s 1.5 MiB (Task 16b, item 117)', async () => {
    // 560,000 characters, 1,560,004 bytes: within both limits as a file; as JSON every quote is escaped, 1.55 MiB.
    const wide = `// ${'界'.repeat(500_000)}\n${'"'.repeat(60_000)}`;
    const file = new File([wide], 'wide.proto');
    expect(file.size).toBeLessThan(REQUEST_MAX);
    expect(new TextEncoder().encode(JSON.stringify(wide)).length).toBeGreaterThan(REQUEST_MAX);
    expect(await readProtoFile(file)).toEqual({ problem: t('pr.file.tooBigSent') });
    // Under the cap it is taken as it is, line ends and quotes counted as JSON sends them.
    const fits = `// ${'界'.repeat(400_000)} "q"\n`;
    expect(await readProtoFile(new File([fits], 'fits.proto'))).toEqual({ content: fits, binary: false });
  });
});
