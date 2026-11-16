/**
 * Gives focus back to the field a save left (useSaveRequest blurs it first). The frame's blur can swap
 * that field for another view: a text box that just received a private key becomes its "not shown"
 * view (schema-form StringField / SecretText, fix round 2, R3.2). Then focus goes to what took its
 * place: an element with the same id, else the control marked `data-replaces="<its id>"` (the Replace
 * button), never body.
 */
export function focusBack(left: HTMLElement | undefined): void {
  if (!left) return;
  if (left.isConnected) {
    left.focus();
    return;
  }
  if (!left.id) return;
  const same = document.getElementById(left.id);
  const replacement = same ?? [...document.querySelectorAll<HTMLElement>('[data-replaces]')].find((el) => el.dataset.replaces === left.id);
  replacement?.focus();
}
