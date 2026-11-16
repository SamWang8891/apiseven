/**
 * Gives focus back to the field a save left (useSaveRequest blurs it first). The frame's blur can swap
 * that field for another view: a text box that just received a private key becomes its "not shown"
 * view (schema-form StringField / SecretText, fix round 2, R3.2). Then focus goes to what took its
 * place: an element with the same id, else the control marked `data-replaces="<its id>"` (the Replace
 * button), never body.
 */
export function focusBack(left: HTMLElement | undefined): boolean {
  if (!left) return false;
  const target = left.isConnected ? left : left.id ? (document.getElementById(left.id) ?? [...document.querySelectorAll<HTMLElement>('[data-replaces]')].find((el) => el.dataset.replaces === left.id)) : undefined;
  target?.focus();
  return target !== undefined && target !== null && document.activeElement === target;
}

/**
 * Where focus goes after a refused save (final wave I1): back where the user was. The field the save
 * left (or what took its place), if it is still there; else the control that started the save (Save,
 * Save anyway, the header's status switch), if it still is; else `fallback` (Save anyway for a save it
 * started, then Save). Never body.
 */
export function returnFocus(left: HTMLElement | undefined, pressed: HTMLElement | undefined, ...fallback: (HTMLElement | null | undefined)[]): void {
  if (focusBack(left)) return;
  for (const target of [pressed, ...fallback]) {
    if (!target?.isConnected) continue;
    target.focus();
    if (document.activeElement === target) return;
  }
}
