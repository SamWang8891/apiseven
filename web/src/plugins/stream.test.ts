// Which plugins can run on a stream route, by name, from the generated source lists.
import { describe, expect, it } from 'vitest';
import { pluginFixture } from '../test/pluginFixture';
import { runsOnStream } from './stream';
import { HTTP_PLUGINS, STREAM_PLUGINS } from './subsystems';

describe('runsOnStream', () => {
  it('a stream plugin runs there, also one that is http too; an http-only one does not; an unknown one is kept', () => {
    expect(runsOnStream('limit-conn')).toBe(true);
    expect(runsOnStream('ip-restriction')).toBe(true);
    expect(runsOnStream('limit-count')).toBe(false);
    expect(runsOnStream('gzip')).toBe(false);
    expect(runsOnStream('my-custom-plugin')).toBe(true);
  });

  it('the generated lists hold every plugin the dev APISIX 3.20 reports, per subsystem', () => {
    const { http, stream } = pluginFixture();
    expect(Object.keys(stream).filter((name) => !STREAM_PLUGINS.includes(name))).toEqual([]);
    expect(Object.keys(http).filter((name) => !HTTP_PLUGINS.includes(name))).toEqual([]);
  });
});
