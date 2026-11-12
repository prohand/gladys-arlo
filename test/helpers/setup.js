// Build a service wired to the fake Gladys of the SDK and to the fake Arlo cloud.

import './quiet.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ArloAuth } from '../../src/arlo/auth.js';
import { ArloClient } from '../../src/arlo/client.js';
import { ArloService } from '../../src/arlo/service.js';
import { normalizeConfig } from '../../src/config.js';
import { createFakeArlo, FakeEventStream } from './fakeArlo.js';

export const CONFIG = normalizeConfig({ email: 'me@x.fr', password: 'secret' });

export async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'gladys-arlo-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * @param {import('node:test').TestContext} t
 * @param {object} [options]
 * @param {object} [options.arlo] overrides of the fake Arlo cloud
 * @param {object} [options.config] overrides of the configuration
 * @param {boolean} [options.start] start the service (default true)
 */
export async function setupService(
  t,
  { arlo: arloOverrides = {}, config = {}, start = true } = {},
) {
  const arlo = createFakeArlo({ authCompleted: true, ...arloOverrides });
  const gladys = createFakeGladys();
  await gladys.connect();
  const client = new ArloClient({ fetch: arlo.fetch });
  const auth = new ArloAuth({ client, dataDir: await tempDir(t) });
  const changes = { count: 0 };
  const service = new ArloService({
    gladys,
    client,
    auth,
    onChange: () => {
      changes.count += 1;
    },
    EventStreamClass: FakeEventStream,
  });
  t.after(() => service.stop());
  if (start) {
    await service.start({ ...CONFIG, ...config });
  }
  return { arlo, gladys, client, auth, service, changes };
}

/** Feature external id of an Arlo device, as the fake Gladys selector builds it. */
export const feature = (gladys, deviceId, key) => gladys.externalIds('arlo', deviceId).feature(key);
export const deviceExt = (gladys, deviceId) => gladys.externalIds('arlo', deviceId).device;
