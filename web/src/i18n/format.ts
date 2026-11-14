export type Vars = Record<string, string | number>;

/** Replaces each {name} in the template with vars[name]; unknown placeholders stay as written. */
export function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}
