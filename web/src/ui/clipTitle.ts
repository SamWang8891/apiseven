import type { FocusEvent, PointerEvent } from 'react';

/** Whether `el`, or an element inside it, is narrower than its text (it ends in an ellipsis). */
export function isClipped(el: HTMLElement): boolean {
  const boxes = [el, ...el.querySelectorAll<HTMLElement>('*')];
  return boxes.some((box) => box.scrollWidth > box.clientWidth + 1);
}

/**
 * Props for an element whose visible text can end in an ellipsis: it gets a `title` with the whole
 * `text` only while that text is cut off, checked when the pointer or focus arrives. A title that
 * repeats the visible text would make screen readers say it twice. `data-clip-title` marks it.
 */
export function clipTitle(text: string) {
  const update = (e: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const el = e.currentTarget;
    if (isClipped(el)) el.title = text;
    else el.removeAttribute('title');
  };
  return { 'data-clip-title': '', onPointerEnter: update, onFocus: update };
}
