// What the "locked: no form controls" tests count (editableControls in schemaForm.tsx).
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { editableControls } from './schemaForm';

describe('editableControls', () => {
  it('counts every box and control, read-only and disabled ones too, also inside an aria-hidden part', () => {
    const { container } = render(
      <div>
        <input readOnly defaultValue="a" />
        <textarea readOnly defaultValue="b" />
        <button type="button" role="checkbox" aria-checked="false" disabled />
        <button type="button" role="radio" aria-checked="true" />
        <div aria-hidden="true">
          <button type="button" role="combobox" />
        </div>
      </div>,
    );
    expect(editableControls(container).map((el) => el.tagName + (el.getAttribute('role') ?? ''))).toEqual(['INPUT', 'TEXTAREA', 'BUTTONcheckbox', 'BUTTONradio', 'BUTTONcombobox']);
  });

  it('skips only what marks itself: the locked code editor, a hidden input, the native input Radix hides beside a checkbox', () => {
    const { container } = render(
      <div>
        <div className="cm-content" contentEditable="true" suppressContentEditableWarning role="textbox" aria-readonly="true">
          text
        </div>
        <input type="hidden" />
        <input type="checkbox" aria-hidden="true" tabIndex={-1} readOnly />
      </div>,
    );
    expect(editableControls(container)).toEqual([]);
  });
});
