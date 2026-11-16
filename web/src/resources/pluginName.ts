// How an overview names one entry of an object's plugins: what the entry does there (entryEffect,
// plugins/entryEffect.ts), never "off" for a plugin that keeps running.
import { t } from '../i18n';

/** "(off)" when APISIX skips the plugin for this object; "(no effect here)" for one it runs for the whole instance; else the name. */
export const pluginName = (p: { name: string; disabled?: boolean; noEffect?: boolean }): string =>
  p.noEffect ? t('rt.overview.pluginNoEffect', { name: p.name }) : p.disabled ? t('rt.overview.pluginOff', { name: p.name }) : p.name;
