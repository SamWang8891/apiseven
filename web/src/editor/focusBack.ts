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
 * Where a control was, so it can be found again after a remount gave it a new element and a new id
 * (fix round 1, F3: the saving state locks the page, and several tabs render another tree while
 * locked): the tab it was on, its kind (role, tag, input type), its accessible name, and which one of
 * that kind and name it was in the tab.
 */
export interface Place {
  tab: string;
  kind: string;
  name: string;
  index: number;
}

/** What can take focus in a tab: form controls, buttons, and what ARIA makes one (a code editor's text). */
const CONTROLS = 'input, textarea, select, button, [role="textbox"], [role="combobox"], [role="switch"], [role="spinbutton"], [role="checkbox"], [role="radio"], [contenteditable="true"]';

const kindOf = (el: Element): string => `${el.getAttribute('role') ?? ''}/${el.tagName.toLowerCase()}/${el instanceof HTMLInputElement ? el.type : ''}`;

/** The accessible name, as far as a place needs it: aria-label, else the text of aria-labelledby, else its <label>s. */
function nameOf(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label) return label.trim();
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const text = by
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text) return text;
  }
  const labels = (el as HTMLInputElement).labels;
  return labels ? [...labels].map((l) => l.textContent ?? '').join(' ').trim() : '';
}

/** The tab a panel shows (Radix names a panel `<base>-content-<tab id>`), stable across remounts. */
const tabOf = (panel: Element): string => /-content-(.+)$/.exec(panel.id)?.[1] ?? '';

const sameAs = (kind: string, name: string) => (el: Element) => kindOf(el) === kind && nameOf(el) === name;

/** The place of `el` in its tab panel, or undefined when it is in none or has no name to find it by. */
export function placeOf(el: HTMLElement): Place | undefined {
  const panel = el.closest('[role="tabpanel"]');
  const name = nameOf(el);
  if (!panel || !name) return undefined;
  const kind = kindOf(el);
  const index = [...panel.querySelectorAll(CONTROLS)].filter(sameAs(kind, name)).indexOf(el);
  return index < 0 ? undefined : { tab: tabOf(panel), kind, name, index };
}

/** The control at `place` in the tab panel shown now: the same tab, kind, name and ordinal; never one of another name. */
export function findPlace(place: Place | undefined, within: ParentNode = document): HTMLElement | undefined {
  if (!place) return undefined;
  const panel = [...within.querySelectorAll('[role="tabpanel"]:not([hidden])')].find((p) => tabOf(p) === place.tab);
  const found = panel ? [...panel.querySelectorAll(CONTROLS)].filter(sameAs(place.kind, place.name))[place.index] : undefined;
  return found instanceof HTMLElement ? found : undefined;
}

/**
 * Where focus goes after a refused save (final wave I1): back where the user was. The field the save
 * left (or what took its place: the same id, data-replaces, else the same place, F3), if it is still
 * there; else the control that started the save (Save,
 * Save anyway, the header's status switch), if it still is; else `fallback` (Save anyway for a save it
 * started, then Save). Never body.
 */
export function returnFocus(left: HTMLElement | undefined, place: Place | undefined, pressed: HTMLElement | undefined, ...fallback: (HTMLElement | null | undefined)[]): void {
  if (focusBack(left)) return;
  const again = findPlace(place);
  again?.focus();
  if (again && document.activeElement === again) return;
  for (const target of [pressed, ...fallback]) {
    if (!target?.isConnected) continue;
    target.focus();
    if (document.activeElement === target) return;
  }
}
