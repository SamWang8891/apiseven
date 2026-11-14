// A plugin config's `_meta`: the options APISIX injects into every plugin schema
// (schema_def.lua plugin_injected_schema: disable, error_response, priority, filter, pre_function).
// The card edits it apart from the plugin's own fields, so these helpers split and join the two.
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';

export const META = '_meta';

/** The config's `_meta` object, if it has one. */
export function metaOf(conf: unknown): Obj | undefined {
  return isObj(conf) && isObj(conf[META]) ? conf[META] : undefined;
}

/** The config without `_meta` (the same object when it has none). */
export function withoutMeta(conf: Obj): Obj {
  if (!Object.hasOwn(conf, META)) return conf;
  const rest = { ...conf };
  delete rest[META];
  return rest;
}

/** `conf` with `_meta` set to `meta` (first, as the APISIX docs write it); none when `meta` is undefined or empty. */
export function withMeta(conf: Obj, meta: Obj | undefined): Obj {
  const rest = withoutMeta(conf);
  return meta && Object.keys(meta).length > 0 ? { [META]: meta, ...rest } : rest;
}

/** Whether `_meta.disable` turns the plugin off. */
export const isDisabled = (conf: unknown): boolean => metaOf(conf)?.disable === true;

/**
 * Off writes `_meta.disable: true` (other `_meta` keys kept); on removes `disable`, and `_meta` with
 * it when nothing else is left there.
 */
export function setDisabled(conf: Obj, off: boolean): Obj {
  const meta = { ...metaOf(conf) };
  if (off) meta.disable = true;
  else delete meta.disable;
  return withMeta(conf, meta);
}

const formSchemas = new WeakMap<Obj, Obj>();

/**
 * The schema for the card's form: `schema` without the `_meta` APISIX injects (the card's own
 * `_meta` section edits that). One copy per schema object, so the form's analysis stays memoised.
 */
export function formSchemaOf(schema: Obj): Obj {
  let copy = formSchemas.get(schema);
  if (!copy) {
    copy = schema;
    if (isObj(schema.properties) && Object.hasOwn(schema.properties, META)) {
      const properties = { ...schema.properties };
      delete properties[META];
      copy = { ...schema, properties };
    }
    formSchemas.set(schema, copy);
  }
  return copy;
}
