import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom gaps, filled with inert stand-ins (not mocks of our code):
// Radix positions popovers, menus and tooltips with ResizeObserver; CodeMirror measures text
// through Range rects. jsdom does no layout, so empty results are the honest answer.
class InertResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= InertResizeObserver;

if (typeof Range !== 'undefined' && !('getClientRects' in Range.prototype)) {
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: (): DOMRect[] => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
}

afterEach(() => {
  cleanup();
});
