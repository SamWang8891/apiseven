// Which plugins can run on a stream route. The stream subsystem runs only its own plugins
// (plugin.stream_filter, apisix/plugin.lua 675–702), so a service's http plugins never run for a
// stream route bound to it. Decided by name from the source lists (subsystems.ts, generated), so a
// list column can use it synchronously; a name in neither list (a custom plugin) is kept.
import { HTTP_PLUGINS, STREAM_PLUGINS } from './subsystems';

const STREAM = new Set(STREAM_PLUGINS);
const HTTP = new Set(HTTP_PLUGINS);

/** Whether a plugin of this name can run on a stream route: a stream plugin, or one APISIX doesn't ship. */
export function runsOnStream(name: string): boolean {
  return STREAM.has(name) || !HTTP.has(name);
}
