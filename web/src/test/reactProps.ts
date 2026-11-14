// The React props an element was rendered with: its handlers as of the last render. Calling two of
// them inside one act runs two changes from the same render with no render between, as two handlers
// in one task would; a handler that reads state through its render's closure then loses the first.
type Handlers = Record<string, ((...args: unknown[]) => void) | undefined>;

export function reactProps(el: Element): Handlers {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
  if (!key) throw new Error('not a React-rendered element');
  return (el as unknown as Record<string, Handlers>)[key] as Handlers;
}

/** An input change as the handler sees it. */
export const changeTo = (value: string) => ({ target: { value } });
